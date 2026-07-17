const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.DOTENV_CONFIG_QUIET = 'true';
process.env.TRIAL_SECRET_KEY ||= 'stokko-test-trial-key-32-bytes-minimum';
process.env.HIST_SECRET ||= 'stokko-test-history-key-32-bytes-minimum';
process.env.HASH_SECRET ||= 'stokko-test-password-key-32-bytes-minimum';

if (process.env.STOKKO_TEST_APPDATA_PID !== String(process.pid)) {
  const testAppData = fs.mkdtempSync(path.join(os.tmpdir(), `stokko-tests-${process.pid}-`));
  process.env.STOKKO_TEST_APPDATA = testAppData;
  process.env.STOKKO_TEST_APPDATA_PID = String(process.pid);
  process.env.APPDATA = testAppData;
  process.env.PROGRAMDATA = path.join(testAppData, 'programdata');
  const dataDir = path.join(testAppData, 'Stokko_Data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'mi-tienda.db'),
    Buffer.concat([Buffer.from('SQLite format 3\0', 'utf8'), Buffer.alloc(128)]),
  );
  process.once('exit', () => fs.rmSync(testAppData, { recursive: true, force: true }));
}
