// Ответы ESPN и VK неожиданной формы дают понятную ошибку, а не пустой список.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDay } from '../src/core/day.mjs';
import { createEspn, shiftYmd } from '../src/core/espn.mjs';
import { resolve } from '../src/core/settings.mjs';
import { FormatError } from '../src/core/shape.mjs';
import { toItems } from '../src/core/vk-items.mjs';
import { notices } from '../src/web/view.mjs';
import { ANDREEVA, SHNAIDER, comp, event, single } from './helpers/espn-data.mjs';

const changed = /изменил формат ответа \(.+\) — нужна новая версия приложения/;
const json = (body) => new Response(JSON.stringify(body));
const finals = event('382-2026', 'WTA Finals', { 'womens-singles': [comp(1, '2026-11-13T20:10Z', single(ANDREEVA), single(SHNAIDER))] });
// сеть: отвечает по туру и дню из адреса и запоминает, что спрашивали
function net(answer) {
  const asked = [];
  const fetchImpl = async (url) => {
    const [, tour, date] = /tennis\/(\w+)\/scoreboard\?dates=(\d+)/.exec(String(url));
    asked.push(`${tour}:${date}`);
    return json(await answer(tour, date));
  };
  return { asked, fetchImpl };
}

test('shiftYmd: соседние дни через месяц и год', () => {
  assert.equal(shiftYmd('20261231', 1), '20270101');
  assert.equal(shiftYmd('20260301', -1), '20260228');
});

test('ESPN: табло без списка events — ошибка формата', async () => {
  const e = createEspn(async () => json({ leagues: [] }));
  await assert.rejects(e.day('20261113'), (err) => err instanceof FormatError && /ESPN.*нет списка events/.test(err.message) && changed.test(err.message));
});

test('ESPN: спрашиваются выбранные туры, сам день и соседние; турниры помечены туром', async () => {
  const { asked, fetchImpl } = net((tour) => ({ events: tour === 'wta' ? [finals] : [] }));
  const day = await createEspn(fetchImpl).day('20261113', ['wta']);
  assert.deepEqual(asked.sort(), ['wta:20261112', 'wta:20261113', 'wta:20261114']);
  assert.deepEqual(day.events.map((ev) => [ev.tour, ev.id]), [['wta', '382-2026']], 'один и тот же турнир из трёх ответов — один раз');
  assert.equal(day.stale, null);
});

test('ESPN: турнир, которого нет в ответе на сам день, берётся из соседнего; сбой соседнего дня не мешает', async () => {
  const { fetchImpl } = net((tour, date) => {
    if (date === '20261114') throw new Error('нет сети');
    return { events: date === '20261112' && tour === 'wta' ? [finals] : [] };
  });
  const day = await createEspn(fetchImpl).day('20261113', ['wta']);
  assert.deepEqual(day.events.map((ev) => ev.id), ['382-2026']);
});

test('ESPN: сам день — из кэша 45 секунд, соседние — полчаса; refresh спрашивает всё заново', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const { asked, fetchImpl } = net(() => ({ events: [] }));
  const e = createEspn(fetchImpl);
  await e.day('20261113', ['atp']);
  await e.day('20261113', ['atp']);
  assert.equal(asked.length, 3, 'второй раз — из кэша');
  t.mock.timers.tick(60e3);
  await e.day('20261113', ['atp']);
  assert.deepEqual(asked.slice(3), ['atp:20261113'], 'через минуту — только сам день');
  e.refresh();
  await e.day('20261113', ['atp']);
  assert.equal(asked.length, 7);
});

test('ESPN сменил формат после удачного ответа — отдаётся прежнее расписание с пометкой', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  let body = { events: [finals] };
  const e = createEspn(async () => json(body));
  await e.day('20261113', ['wta']);
  body = { data: [] };
  t.mock.timers.tick(60e3);
  const day = await e.day('20261113', ['wta']);
  assert.equal(day.events.length, 1);
  assert.equal(day.stale.format, true);
  assert.match(day.stale.message, changed);
  const built = buildDay({ data: day, date: '20261113', tz: 'UTC', settings: resolve({}), snapshot: { streams: [] } });
  assert.equal(built.stale.format, true);
  assert.equal(built.leagues.length, 1);
  assert.match(notices({ day: built })[0][1], /ESPN изменил формат ответа.*Показано расписание, полученное ранее/);
});

test('ESPN недоступен после удачного ответа — прежнее расписание и пометка без «формата»', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  let down = false;
  const e = createEspn(async () => (down ? new Response('', { status: 503 }) : json({ events: [finals] })));
  await e.day('20261113', ['wta']);
  down = true;
  t.mock.timers.tick(60e3);
  const day = await e.day('20261113', ['wta']);
  assert.deepEqual([day.events.length, day.stale.format, day.stale.message], [1, false, 'ESPN ответил 503']);
  assert.match(notices({ day: { stale: day.stale } })[0][1], /ESPN сейчас недоступен/);
});

test('VK: ни у одного видео нет номера и названия — ошибка формата; пустой список и обычные видео — нет', () => {
  assert.throws(() => toItems([{ video_id: 1, name: 'Андреева — Шнайдер' }], { label: 'X' }), /VK изменил формат ответа/);
  assert.deepEqual(toItems([], { label: 'X' }), []);
  assert.deepEqual(toItems([{ owner_id: -1, id: 1, title: 'Обзор дня' }], { label: 'X' }), []);
});

test('VK: эфир пары помечен, эфир одиночного матча — нет', () => {
  const video = (id, title) => ({ owner_id: -1, id, title, live_status: 'started' });
  const [one, two] = toItems([video(1, 'Мирра Андреева — Диана Шнайдер | WTA Finals'), video(2, 'Перес/Схюрс — Эррани/Паолини | WTA Finals')], { label: 'X' });
  assert.deepEqual([one.doubles, one.teams, two.doubles, two.teams], [false, ['мирра андреева', 'диана шнайдер'], true, ['перес схюрс', 'еррани паолини']]);
});
