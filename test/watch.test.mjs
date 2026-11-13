import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { resolve } from '../src/core/settings.mjs';
import { watchFavorites } from '../src/core/watch.mjs';
import { ANDREEVA, SHNAIDER, board, comp, event, single } from './helpers/espn-data.mjs';

const KICKOFF = Date.parse('2026-09-20T15:30:00Z');
const MIN = 60e3;

// Матч в табло ESPN; match.state меняется по ходу теста
function setup(user = { favorites: [{ id: 8017, name: 'Diana Shnaider' }] }) {
  const match = { state: 'pre', timeValid: true };
  const data = () => board({ wta: [event('382-2026', 'WTA Finals', {
    'womens-singles': [comp(7, new Date(KICKOFF).toISOString(), single(ANDREEVA), single(SHNAIDER), { state: match.state, timeValid: match.timeValid, sets: match.state === 'pre' ? [[], []] : [[1], [0]] })],
  })] });
  const poller = new EventEmitter();
  poller.snapshot = () => ({ streams: [] });
  let now = KICKOFF - 60 * MIN;
  const events = [];
  const w = watchFavorites({
    poller, settings: { get: () => resolve(user), on() {} }, espn: { day: async () => data() },
    onEvent: (e) => events.push(e.kind), now: () => now, log: {},
  });
  return { events, match, at: async (t) => { now = t; return w.check(); }, stop: w.stop };
}

test('за 15 минут и в начале матча — по одному разу', async () => {
  const t = setup();
  await t.at(KICKOFF - 40 * MIN);
  await t.at(KICKOFF - 20 * MIN);
  await t.at(KICKOFF - 15 * MIN);
  await t.at(KICKOFF - 14 * MIN);
  await t.at(KICKOFF - 5 * MIN);
  t.match.state = 'in';
  await t.at(KICKOFF + 1 * MIN);
  await t.at(KICKOFF + 3 * MIN);
  t.stop();
  assert.deepEqual(t.events, ['soon', 'kickoff']);
});

test('матч задержался: ждём по минуте, «начался» приходит, когда он действительно пошёл', async () => {
  const t = setup();
  await t.at(KICKOFF - 15 * MIN);
  assert.equal(await t.at(KICKOFF + 30 * MIN), KICKOFF + 31 * MIN, 'время прошло, матч не идёт — через минуту ещё раз');
  assert.deepEqual(t.events, ['soon']);
  t.match.state = 'in';
  await t.at(KICKOFF + 90 * MIN);
  t.stop();
  assert.deepEqual(t.events, ['soon', 'kickoff']);
});

test('отмеченный колокольчиком матч уведомляет, даже если игроки не в избранном', async () => {
  // время в записи нужно только для очистки прошедших матчей (по настоящим часам), поэтому — будущее
  const utcTime = new Date(Date.now() + 3600e3).toISOString();
  const t = setup({ favoriteMatches: [{ id: 7, name: 'Mirra Andreeva — Diana Shnaider', utcTime }] });
  await t.at(KICKOFF - 15 * MIN);
  t.match.state = 'in';
  await t.at(KICKOFF + 1 * MIN);
  t.stop();
  assert.deepEqual(t.events, ['soon', 'kickoff']);
});

test('приложение открыли за 5 минут до начала — напоминание сразу; через полчаса после начала — уже нет', async () => {
  const late = setup();
  await late.at(KICKOFF - 5 * MIN);
  late.stop();
  assert.deepEqual(late.events, ['soon']);

  const tooLate = setup();
  tooLate.match.state = 'in';
  await tooLate.at(KICKOFF + 30 * MIN);
  tooLate.stop();
  assert.deepEqual(tooLate.events, []);
});

test('следующая проверка — к ближайшему моменту: за 15 минут до начала, потом к началу', async () => {
  const t = setup();
  assert.equal(await t.at(KICKOFF - 60 * MIN), KICKOFF - 15 * MIN);
  assert.equal(await t.at(KICKOFF - 15 * MIN), KICKOFF);
  t.match.state = 'in';
  assert.equal(await t.at(KICKOFF + 1 * MIN), Infinity);
  t.stop();
  assert.deepEqual(t.events, ['soon', 'kickoff']);
});

test('время матча не назначено — напоминать не о чем', async () => {
  const t = setup();
  t.match.timeValid = false;
  assert.equal(await t.at(KICKOFF - 10 * MIN), Infinity);
  t.stop();
  assert.deepEqual(t.events, []);
});

test('без избранного и с выключенными уведомлениями — тишина', async () => {
  for (const user of [{}, { favorites: [{ id: 9820, name: 'Mirra Andreeva' }], notifications: false }]) {
    const t = setup(user);
    await t.at(KICKOFF - 10 * MIN);
    t.match.state = 'in';
    await t.at(KICKOFF + 1 * MIN);
    t.stop();
    assert.deepEqual(t.events, []);
  }
});
