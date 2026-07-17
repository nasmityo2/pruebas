#!/usr/bin/env node
const { migrateToStokko, rollbackStokkoMigration } = require('../src/utils/migration');

try {
  const result = process.argv.includes('--rollback')
    ? rollbackStokkoMigration()
    : migrateToStokko();
  console.log(`[STOKKO_DATA_MIGRATION] ${result.status}`);
} catch (error) {
  console.error('[STOKKO_DATA_MIGRATION_FAILED]', error.message);
  process.exitCode = 1;
}
