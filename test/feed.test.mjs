// Лента: что и когда ядро присылает подписанной странице.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createFeed } from '../src/core/feed.mjs';
import { resolve } from '../src/core/settings.mjs';
import { ANDREEVA, SHNAIDER, board, comp, event, single } from './helpers/espn-data.mjs';

const pause = (ms = 5) => new Promise((r) => setTimeout(r, ms));

function setup({ dayMs = 1e9, retryMs = 1e9 } = {}) {
  const state = { games: 0, streams: [], fail: null, user: {}, calls: 0, tours: null };
  const poller = Object.assign(new EventEmitter(), { snapshot: () => ({ ready: true, channels: [], streams: state.streams }) });
  const settings = Object.assign(new EventEmitter(), { warnings: [], get: () => resolve(state.user) });
  const espn = {
    day: async (date, tours) => {
      state.calls++;
      state.tours = tours;
      if (state.fail) throw new Error(state.fail);
      return board({ wta: [event('382-2026', 'WTA Finals', {
        'womens-singles': [comp(7, '2026-09-20T15:00Z', single(ANDREEVA), single(SHNAIDER), { state: 'in', sets: [[state.games], [0]] })],
      })] });
    },
  };
  const feed = createFeed({ settings, poller, espn, version: 'v', dayMs, retryMs });
  const log = [];
  const sub = () => feed.subscribe({ date: '20260920', tz: 'UTC' }, (event, json) => log.push([event, JSON.parse(json)]));
  return { state, poller, settings, feed, log, sub, names: () => log.map(([e]) => e) };
}
const firstMatch = (entry) => entry[1].leagues[0].matches[0];

test('подписка сразу получает состояние каналов и расписание', async () => {
  const t = setup();
  const stop = t.sub();
  await pause();
  stop();
  assert.deepEqual(t.names().sort(), ['day', 'status']);
  assert.equal(t.log.find(([e]) => e === 'status')[1].version, 'v');
  assert.equal(firstMatch(t.log.find(([e]) => e === 'day')).home.name, 'Mirra Andreeva');
  assert.deepEqual(t.state.tours, ['atp', 'wta']);
});

test('спрашиваются только туры выбранных разрядов', async () => {
  const t = setup();
  t.state.user = { leagues: [2, 4] };
  const stop = t.sub();
  await pause();
  stop();
  assert.deepEqual(t.state.tours, ['wta']);
});

test('по часам присылается только изменившееся: счёт поменялся — расписание, нет — ничего', async () => {
  const t = setup({ dayMs: 20 });
  const stop = t.sub();
  await pause();
  const before = t.log.length;
  await pause(60);
  assert.equal(t.log.length, before, 'ничего не изменилось — ничего не пришло');
  assert.ok(t.state.calls > 1, 'но ESPN спрашивали');
  t.state.games = 1;
  await pause(60);
  stop();
  assert.equal(t.log.at(-1)[0], 'day');
  assert.equal(firstMatch(t.log.at(-1)).home.sets[0].games, 1);
});

test('прочитаны каналы или сохранены настройки — расписание приходит сразу, не дожидаясь круга', async () => {
  const t = setup();
  const stop = t.sub();
  await pause();
  t.state.streams = [{ title: 'Андреева — Шнайдер', teams: ['андреева', 'шнайдер'], doubles: false, status: 'started', time: null, url: 'u', channel: 'X' }];
  t.poller.emit('update');
  await pause();
  assert.deepEqual(firstMatch(t.log.at(-1)).streams.map((s) => s.url), ['u']);
  assert.equal(t.log.at(-2)[0], 'status');
  t.state.user = { favorites: [{ id: 9820, name: 'Mirra Andreeva' }] };
  t.settings.emit('change');
  await pause();
  stop();
  assert.equal(firstMatch(t.log.at(-1)).favorite, true);
});

test('сбой ESPN — ошибка; после сбоя расписание приходит заново, даже прежнее', async () => {
  const t = setup();
  const stop = t.sub();
  await pause();
  t.state.fail = 'ESPN ответил 503';
  t.poller.emit('update');
  await pause();
  assert.deepEqual(t.log.at(-1), ['day-error', { message: 'ESPN ответил 503' }]);
  t.state.fail = null;
  t.poller.emit('update');
  await pause();
  stop();
  assert.equal(t.log.at(-1)[0], 'day');
});

test('после сбоя следующий круг — через retryMs, а не через dayMs', async () => {
  const t = setup({ retryMs: 20 });
  t.state.fail = 'нет сети';
  const stop = t.sub();
  await pause();
  t.state.fail = null;
  await pause(60);
  stop();
  assert.deepEqual(t.names().filter((e) => e !== 'status'), ['day-error', 'day']);
});

test('после отписки ничего не приходит и ядро никого не слушает', async () => {
  const t = setup({ dayMs: 10 });
  const stop = t.sub();
  await pause();
  stop();
  const before = t.log.length;
  t.state.games = 5;
  t.poller.emit('update');
  await pause(40);
  assert.equal(t.log.length, before);
  assert.equal(t.poller.listenerCount('update'), 0);
  assert.equal(t.settings.listenerCount('change'), 0);
  t.sub();
  t.feed.close();
  assert.equal(t.poller.listenerCount('update'), 0);
});
