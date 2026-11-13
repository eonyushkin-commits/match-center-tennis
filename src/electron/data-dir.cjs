// Папка данных приложения — на латинице и своя, отдельная от футбольного «Матч-центра»:
// %APPDATA%\TennisCenter. У запуска из исходников папка своя (см. main.cjs).
const path = require('node:path');

const NAMES = { packaged: 'TennisCenter', dev: 'TennisCenter-dev' };

function dataDir(appData, packaged) {
  return path.join(appData, packaged ? NAMES.packaged : NAMES.dev);
}

module.exports = { dataDir };
