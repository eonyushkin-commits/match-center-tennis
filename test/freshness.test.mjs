// Свежесть счёта: время последнего настоящего ответа ESPN, а не перерисовки или чтения кэша.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDay } from '../src/core/day.mjs';
import { createEspn } from '../src/core/espn.mjs';
import { resolve } from '../src/core/settings.mjs';
import { stamp } from '../src/web/format.mjs';
import { footHtml, notices } from '../src/web/view.mjs';

const json = (body) => new Response(JSON.stringify(body));
const T0 = Date.parse('2026-11-14T12:00:00Z');

test('ESPN: fetchedAt — время ответа; кэш и сбой его не меняют, refresh — только при удаче', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  let down = false;
  const e = createEspn(async () => (down ? new Response('', { status: 503 }) : json({ events: [] })));
  assert.equal((await e.day('20261114', ['atp'])).fetchedAt, T0);

  t.mock.timers.tick(10e3);
  assert.equal((await e.day('20261114', ['atp'])).fetchedAt, T0, 'чтение кэша — прежнее время');

  t.mock.timers.tick(60e3);
  down = true;
  const failed = await e.day('20261114', ['atp']);
  assert.deepEqual([failed.fetchedAt, !!failed.stale], [T0, true], 'сбой — прежнее время и пометка');

  e.refresh();
  t.mock.timers.tick(5e3);
  assert.equal((await e.day('20261114', ['atp'])).fetchedAt, T0, 'refresh без ответа ESPN время не двигает');

  down = false;
  e.refresh();
  assert.equal((await e.day('20261114', ['atp'])).fetchedAt, T0 + 75e3, 'refresh с ответом — новое время');
});

test('ESPN: из нескольких туров — самое давнее время; соседние дни на него не влияют', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  let wtaDown = false;
  const e = createEspn(async (url) => {
    if (wtaDown && url.includes('/wta/')) throw new Error('нет сети');
    return json({ events: [] });
  });
  await e.day('20261114', ['atp', 'wta']);
  t.mock.timers.tick(60e3);
  wtaDown = true;
  const day = await e.day('20261114', ['atp', 'wta']);
  assert.equal(day.fetchedAt, T0, 'WTA не ответил — показываем время WTA, а не свежее ATP');
});

test('buildDay передаёт fetchedAt странице', () => {
  const built = buildDay({ data: { events: [], stale: null, fetchedAt: T0 }, date: '20261114', tz: 'UTC', settings: resolve({}), snapshot: { streams: [] } });
  assert.equal(built.fetchedAt, T0);
});

test('stamp: сегодня — только время, другой день — с датой', () => {
  const now = new Date(2026, 10, 14, 15, 0).getTime();
  assert.equal(stamp(new Date(2026, 10, 14, 9, 5).getTime(), now), '09:05');
  assert.equal(stamp(new Date(2026, 10, 13, 23, 50).getTime(), now), '13.11 23:50');
});

test('подвал и полоса сбоя показывают время последнего ответа ESPN', () => {
  const now = new Date(2026, 10, 14, 15, 0).getTime();
  const at = new Date(2026, 10, 14, 14, 58).getTime();
  assert.match(footHtml({ version: '1.0.7', day: { fetchedAt: at, stale: null } }, now), /Матч-центр 1\.0\.7 · <span class="" [^>]*>счёт ESPN от 14:58<\/span>/);
  assert.match(footHtml({ version: '1.0.7', day: { fetchedAt: at, stale: { message: 'x' } } }, now), /class="stale"[^>]*>счёт ESPN от 14:58 \(не обновляется\)/);
  assert.doesNotMatch(footHtml({ version: '1.0.7', day: null }, now), /ESPN/);
  assert.match(notices({ day: { fetchedAt: at, stale: { message: 'ESPN ответил 503' } } }, now)[0][1], /ESPN сейчас недоступен<\/b> — показано расписание от 14:58\./);
  assert.match(notices({ error: 'нет связи', day: { fetchedAt: at } }, now)[0][1], /нет связи\. Показано расписание от 14:58\./);
  assert.match(notices({ day: { stale: { message: 'x' } } }, now)[0][1], /показано расписание, полученное ранее\./);
});
