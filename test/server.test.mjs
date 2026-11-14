import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createFeed } from '../src/core/feed.mjs';
import { createHandler, startServer } from '../src/core/server.mjs';
import { openSettings } from '../src/core/settings.mjs';
import { ANDREEVA, SHNAIDER, board, comp, event, single } from './helpers/espn-data.mjs';

let srv;
let base;

const data = board({ wta: [event('382-2026', 'WTA Finals', {
  'womens-singles': [comp(100, '2026-09-20T15:30Z', single(ANDREEVA), single(SHNAIDER), { state: 'in', sets: [[6, 2], [4, 3]], round: 'Semifinal' })],
})] });
const snapshot = {
  ready: true, updatedAt: 1, channels: [],
  streams: [{ title: 'Мирра Андреева — Диана Шнайдер', teams: ['мирра андреева', 'диана шнайдер'], doubles: false, status: 'started', time: null, url: 'u', embed: 'e', channel: 'X' }],
};

before(async () => {
  const settings = await openSettings(await mkdtemp(path.join(os.tmpdir(), 'mc-server-')));
  const poller = Object.assign(new EventEmitter(), { snapshot: () => snapshot, retry() {} });
  const espn = { day: async () => data, refresh() {} };
  const feed = createFeed({ settings, poller, espn, version: 'test' });
  const handler = createHandler({ settings, poller, espn, feed });
  ({ server: srv, url: base } = await startServer(handler));
});
after(() => srv.close());

// первые события ленты с такими именами: { имя: данные }
async function events(query, names) {
  const r = await fetch(`${base}/api/events?${query}`);
  assert.match(r.headers.get('content-type'), /^text\/event-stream/);
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  const got = {};
  let text = '';
  while (names.some((n) => !(n in got))) {
    const { value, done } = await reader.read();
    if (done) break;
    text += value;
    for (const [, name, data] of text.matchAll(/event: ([\w-]+)\ndata: (.*)\n\n/g)) got[name] = JSON.parse(data);
  }
  await reader.cancel();
  return got;
}

test('/api/events: расписание — турнир и разряд, счёт по сетам, привязанный эфир; состояние каналов', async () => {
  const { day: j, status } = await events('date=20260920&tz=Europe/Moscow', ['day', 'status']);
  assert.equal(status.version, 'test');
  assert.equal(status.vk.streamCount, 1);
  assert.equal(j.leagues.length, 1);
  assert.deepEqual([j.leagues[0].name, j.leagues[0].country], ['WTA Finals', 'Женщины · одиночный разряд']);
  const m = j.leagues[0].matches[0];
  assert.deepEqual([m.home.name, m.liveTime, m.round, m.home.score], ['Mirra Andreeva', '2-й сет', 'Полуфинал', 1]);
  assert.deepEqual(m.streams.map((s) => s.url), ['u']);
});

test('/api/settings: вместе с настройками — список разрядов', async () => {
  const s = await (await fetch(`${base}/api/settings`)).json();
  assert.deepEqual(s.knownLeagues.map((l) => l.id), [1, 2, 3, 4]);
  assert.deepEqual(s.leagues, [1, 2], 'по умолчанию — одиночные разряды');
  assert.equal((await fetch(`${base}/api/leagues`)).status, 404);
});

test('/api/events: неверные параметры — 400, а не падение', async () => {
  assert.equal((await fetch(`${base}/api/events?date=2026-09-20`)).status, 400);
  assert.equal((await fetch(`${base}/api/events?date=20260920&tz=Mars/Olympus`)).status, 400);
});

test('/api/settings: сохранение и проверка входных данных', async () => {
  const put = (body, type = 'application/json') => fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'Content-Type': type }, body });
  const ok = await put(JSON.stringify({ favorites: [{ id: 9820, name: 'Mirra Andreeva' }] }));
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).favorites, [{ id: 9820, name: 'Mirra Andreeva' }]);
  assert.equal((await put('{"leagues": []}')).status, 400);
  assert.equal((await put('{"leagues": [47]}')).status, 400, 'неизвестный разряд');
  assert.equal((await put('not json')).status, 400);
  assert.equal((await put('{}', 'text/plain')).status, 415, 'форма с чужой страницы не пройдёт');
  const { day } = await events('date=20260920&tz=UTC', ['day']);
  assert.equal(day.leagues[0].matches[0].favorite, true);
});

test('чужой Host отклоняется (защита от подмены DNS)', async () => {
  const { port } = new URL(base);
  const r = await new Promise((resolve, reject) => {
    import('node:http').then(({ request }) => {
      request({ host: '127.0.0.1', port, path: '/api/settings', headers: { Host: 'evil.example' } }, resolve).on('error', reject).end();
    });
  });
  assert.equal(r.statusCode, 403);
});

test('страница отдаётся с CSP, лишние пути — 404', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-src https:\/\/vkvideo\.ru/);
  assert.match(page.headers.get('content-security-policy'), /img-src 'self' data: https:\/\/a\.espncdn\.com;/);
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);
  assert.equal((await fetch(`${base}/src/core/settings.mjs`)).status, 404);
});

test('отдаются все модули, которые импортирует страница', async () => {
  const web = new URL('../src/web/', import.meta.url);
  const files = (await readdir(web)).filter((f) => /\.m?js$/.test(f));
  const wanted = new Set(['app.js']);
  for (const f of files)
    for (const [, dep] of (await readFile(new URL(f, web), 'utf8')).matchAll(/from '\.\/([\w-]+\.mjs)'/g)) wanted.add(dep);
  for (const f of wanted) {
    const r = await fetch(`${base}/${f}`);
    assert.equal(r.status, 200, f);
    assert.match(r.headers.get('content-type'), /^text\/javascript/, f);
  }
});
