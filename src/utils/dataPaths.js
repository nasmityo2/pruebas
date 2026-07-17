const path = require('path');

const STOKKO_DATA_DIR = 'Stokko_Data';

function getRoamingBase(env = process.env, platform = process.platform) {
  if (env.APPDATA) return env.APPDATA;
  if (platform === 'darwin') {
    return path.join(env.HOME || '', 'Library', 'Application Support');
  }
  if (platform === 'win32') {
    return path.join(env.USERPROFILE || '', 'AppData', 'Roaming');
  }
  return env.HOME ? path.join(env.HOME, '.local', 'share') : '/var/local';
}

function getProgramDataBase(env = process.env) {
  return env.PROGRAMDATA || 'C:\\ProgramData';
}

function getStokkoDataPath(env = process.env, platform = process.platform) {
  return path.join(getRoamingBase(env, platform), STOKKO_DATA_DIR);
}

function getLegacyDataPaths(env = process.env, platform = process.platform) {
  return [
    path.join(getRoamingBase(env, platform), ['Bodega', 'pp_Data'].join('')),
    path.join(getProgramDataBase(env), ['Bodega', 'pp_Data'].join('')),
  ];
}

module.exports = {
  STOKKO_DATA_DIR,
  getRoamingBase,
  getProgramDataBase,
  getStokkoDataPath,
  getLegacyDataPaths,
};
