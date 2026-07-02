const fs = require('fs');
const path = require('path');

/**
 * Utility to migrate data from ProgramData to AppData (Roaming)
 * This ensures no data loss when moving from a per-machine to a per-user installation.
 */
async function migrateFromProgramData() {
  const oldPath = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'BodegApp_Data');
  const newPath = path.join(process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : '/var/local'), 'BodegApp_Data');
  const flagFile = path.join(newPath, 'migration_completed.txt');

  console.log('[MIGRATION] Checking for data migration...');
  console.log(`[MIGRATION] Old Path: ${oldPath}`);
  console.log(`[MIGRATION] New Path: ${newPath}`);

  // 1. Check if migration was already done
  if (fs.existsSync(flagFile)) {
    console.log('[MIGRATION] Migration already marked as completed. Skipping.');
    return;
  }

  // 2. Check if old path exists and has content
  if (!fs.existsSync(oldPath)) {
    console.log('[MIGRATION] Old data directory not found. Nothing to migrate.');
    // Create flag anyway to avoid future checks
    ensureDirectoryExistence(flagFile);
    fs.writeFileSync(flagFile, `No old data found at ${new Date().toISOString()}`);
    return;
  }

  // 3. Ensure new directory exists
  if (!fs.existsSync(newPath)) {
    try {
      fs.mkdirSync(newPath, { recursive: true });
    } catch (err) {
      console.error(`[MIGRATION] Error creating new data directory: ${err.message}`);
      return;
    }
  }

  // 4. Perform migration (Copy files)
  console.log('[MIGRATION] Starting file copy from ProgramData to AppData...');
  try {
    copyRecursiveSync(oldPath, newPath);
    
    // 5. Success! Create flag file
    fs.writeFileSync(flagFile, `Migration completed successfully on ${new Date().toISOString()}\nSource: ${oldPath}`);
    console.log('[MIGRATION] Data migration finished successfully.');
  } catch (err) {
    console.error(`[MIGRATION] Error during data migration: ${err.message}`);
  }
}

/**
 * Recursively copies a directory or file
 */
function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();

  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest);
    }
    fs.readdirSync(src).forEach((childItemName) => {
      // Avoid copying the flag file if it somehow exists in source
      if (childItemName === 'migration_completed.txt') return;
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    // Files: copy only if destination doesn't exist or is older
    // We favor not overwriting existing data in AppData if the user already started using it
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
      console.log(`[MIGRATION] Copied: ${path.basename(src)}`);
    } else {
      console.log(`[MIGRATION] Skipped (exists in target): ${path.basename(src)}`);
    }
  }
}

function ensureDirectoryExistence(filePath) {
  const dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) {
    return true;
  }
  ensureDirectoryExistence(dirname);
  fs.mkdirSync(dirname);
}

module.exports = { migrateFromProgramData };
