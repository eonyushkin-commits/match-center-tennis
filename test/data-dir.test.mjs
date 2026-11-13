import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const { dataDir } = createRequire(import.meta.url)('../src/electron/data-dir.cjs');

test('dataDir: папка на латинице, своя у тенниса и отдельная у запуска из исходников', () => {
  const root = path.join('C:', 'Users', 'x', 'AppData', 'Roaming');
  assert.equal(dataDir(root, true), path.join(root, 'TennisCenter'));
  assert.equal(dataDir(root, false), path.join(root, 'TennisCenter-dev'));
  assert.notEqual(dataDir(root, true), path.join(root, 'MatchCenter'), 'настройки футбольного приложения не трогаем');
});
