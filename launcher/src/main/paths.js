'use strict';
const path = require('path');
const os = require('os');

/** Default data directory: %APPDATA%/.norelauncher, ~/Library/Application Support/norelauncher, ~/.norelauncher */
function defaultRoot() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '.norelauncher');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'norelauncher');
  return path.join(os.homedir(), '.norelauncher');
}

let root = process.env.NORE_LAUNCHER_HOME || defaultRoot();

module.exports = {
  defaultRoot,
  setRoot(r) { root = r; },
  get root() { return root; },
  get versions() { return path.join(root, 'versions'); },
  get libraries() { return path.join(root, 'libraries'); },
  get assets() { return path.join(root, 'assets'); },
  get runtime() { return path.join(root, 'runtime'); },
  get instances() { return path.join(root, 'instances'); },
  get cache() { return path.join(root, 'cache'); },
  get configFile() { return path.join(root, 'launcher.json'); },
};
