#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const HISTORY_LIMIT = 50;
const SKIP_REPO_DIRS = new Set(['.git', 'node_modules', 'out', 'dist', 'build', 'tmp', 'temp']);
const TEXT_EXTENSIONS = new Set([
  '', '.bat', '.cfg', '.cmd', '.css', '.env', '.html', '.ini', '.js', '.json',
  '.jsx', '.md', '.mjs', '.ps1', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
]);
const RUNTIME_NAMES = new Set([
  'access.log', 'activation_tokens.json', 'invites.json', 'licenses.json',
  'trials.json', 'users.json',
]);
const COMPROMISED_MARKERS = [
  ['super', 'secret'].join('-'),
  [['bodega', 'pp'].join(''), 'master'].join('-'),
  [['bodega', 'pp'].join(''), 'secreto'].join('-'),
  [['bodega', 'pp'].join(''), 'super', 'secreto'].join('-'),
];
const compromisedExpression = `(?:${COMPROMISED_MARKERS.join('|')})[\\w!.-]*`;
const CONTENT_RULES = [
  {
    id: 'private-key',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    grep: '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----',
  },
  {
    id: 'aws-access-key',
    regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
    grep: '(AKIA|ASIA)[A-Z0-9]{16}',
  },
  {
    id: 'github-token',
    regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
    grep: 'gh[pousr]_[A-Za-z0-9]{30,}',
  },
  {
    id: 'npm-token',
    regex: /\bnpm_[A-Za-z0-9]{30,}\b/,
    grep: 'npm_[A-Za-z0-9]{30,}',
  },
  {
    id: 'compromised-placeholder',
    regex: new RegExp(`\\b${compromisedExpression}`, 'i'),
    grep: `(${COMPROMISED_MARKERS.join('|')})[A-Za-z0-9_!.-]*`,
  },
];

const findings = [];
const scanned = { repo: 0, staged: 0, history: 0, artifact: 0 };

function normalize(value) {
  return String(value).replace(/\\/g, '/');
}

function addFinding(scope, relativePath, rule) {
  findings.push({ scope, path: normalize(relativePath), rule });
}

function forbiddenName(relativePath, artifact) {
  const normalized = normalize(relativePath);
  const base = path.posix.basename(normalized).toLowerCase();
  if (base === '.env' || (base.startsWith('.env.') && base !== '.env.example')) return 'env-file';
  if (RUNTIME_NAMES.has(base)) return 'runtime-data';
  if (/\.(?:key|pem|p12|pfx|lic|db|sqlite|sqlite3)$/i.test(base)) return 'sensitive-extension';
  if (artifact && /\.(?:map|ts|tsx|jsx)$/i.test(base)) return 'release-source-or-map';
  return null;
}

function scanContent(scope, relativePath, buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_TEXT_BYTES || buffer.includes(0)) return;
  const ext = path.extname(relativePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) return;
  const content = buffer.toString('utf8');
  for (const rule of CONTENT_RULES) {
    if (rule.regex.test(content)) addFinding(scope, relativePath, rule.id);
  }
}

function scanFilesystem(rootDir, scope, options = {}) {
  const artifact = !!options.artifact;
  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (!artifact && entry.isDirectory() && SKIP_REPO_DIRS.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(rootDir, absolute);
      scanned[scope] += 1;
      const nameRule = forbiddenName(relative, artifact);
      if (nameRule) addFinding(scope, relative, nameRule);
      scanContent(scope, relative, fs.readFileSync(absolute));
    }
  }
  walk(rootDir);
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: options.encoding === null ? null : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function splitNul(buffer) {
  return buffer.toString('utf8').split('\0').filter(Boolean);
}

function scanStaged() {
  const paths = splitNul(git(
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'],
    { encoding: null },
  ));
  for (const relative of paths) {
    scanned.staged += 1;
    const nameRule = forbiddenName(relative, false);
    if (nameRule) addFinding('staged', relative, nameRule);
    try {
      scanContent('staged', relative, git(['show', `:${relative}`], { encoding: null }));
    } catch (_) {
      addFinding('staged', relative, 'unreadable-staged-file');
    }
  }
}

function scanHistory() {
  const commits = git(['log', `-${HISTORY_LIMIT}`, '--format=%H'])
    .split(/\r?\n/)
    .filter(Boolean);
  for (const commit of commits) {
    const paths = splitNul(git(['ls-tree', '-r', '--name-only', '-z', commit], { encoding: null }));
    for (const relative of paths) {
      scanned.history += 1;
      const nameRule = forbiddenName(relative, false);
      if (nameRule) addFinding('history', `${commit.slice(0, 12)}:${relative}`, nameRule);
    }
    for (const rule of CONTENT_RULES) {
      try {
        const matches = git(['grep', '-I', '-l', '-E', '-e', rule.grep, commit])
          .split(/\r?\n/)
          .filter(Boolean);
        for (const match of matches) addFinding('history', match, rule.id);
      } catch (error) {
        if (error.status !== 1) throw error;
      }
    }
  }
}

function parseArguments(argv) {
  const artifacts = [];
  let repo = true;
  let staged = true;
  let history = true;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo-only') {
      repo = true;
      staged = false;
      history = false;
    } else if (arg === '--staged-only') {
      repo = false;
      staged = true;
      history = false;
    } else if (arg === '--history-only') {
      repo = false;
      staged = false;
      history = true;
    } else if (arg === '--artifact') {
      if (!argv[i + 1]) throw new Error('Falta la ruta después de --artifact.');
      artifacts.push(path.resolve(argv[i + 1]));
      i += 1;
    } else if (arg.startsWith('--artifact=')) {
      artifacts.push(path.resolve(arg.slice('--artifact='.length)));
    } else {
      throw new Error(`Argumento desconocido: ${arg}`);
    }
  }
  return { artifacts, repo, staged, history };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  console.log('[check-no-secrets] Escaneando repo, staged e historial reciente...');
  if (options.repo) scanFilesystem(ROOT, 'repo');
  if (options.staged) scanStaged();
  if (options.history) scanHistory();
  for (const artifactPath of options.artifacts) {
    if (!fs.existsSync(artifactPath)) throw new Error(`Artefacto inexistente: ${artifactPath}`);
    scanFilesystem(artifactPath, 'artifact', { artifact: true });
  }

  if (findings.length) {
    console.error(`[check-no-secrets] BLOQUEADO: ${findings.length} hallazgo(s).`);
    for (const finding of findings) {
      console.error(`- [${finding.scope}] ${finding.rule}: ${finding.path}`);
    }
    process.exit(1);
  }

  console.log(
    `[check-no-secrets] OK: repo=${scanned.repo}, staged=${scanned.staged}, ` +
    `history=${scanned.history}, artifact=${scanned.artifact}.`,
  );
}

try {
  main();
} catch (error) {
  console.error('[check-no-secrets] ERROR:', error.message);
  process.exit(1);
}
