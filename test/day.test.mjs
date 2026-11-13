// Расписание дня из табло ESPN: разряды, день в часовом поясе, счёт по сетам, эфиры.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDay, toursOf, ymdIn } from '../src/core/day.mjs';
import { parsePair } from '../src/core/match.mjs';
import { resolve } from '../src/core/settings.mjs';
import {
  ANDREEVA, ERRANI, FRITZ, MUSETTI, PAOLINI, SABALENKA, SHNAIDER, SINIAKOVA, SVITOLINA, TOWNSEND, board, comp, event, pair, single, tbd,
} from './helpers/espn-data.mjs';

const ALL = { leagues: [1, 2, 3, 4] }; // по умолчанию — только одиночные разряды
const build = (data, o = {}) => buildDay({ data, date: '20261113', tz: 'UTC', settings: resolve(ALL), snapshot: { streams: [] }, now: Date.parse('2026-11-13T12:00Z'), ...o });
const finals = (...singles) => board({ wta: [event('382-2026', 'WTA Finals', { 'womens-singles': singles })] });
// единственный матч: из готового дня или из данных табло
const only = (x) => (x.leagues ? x : build(x)).leagues[0].matches[0];

test('toursOf: какие туры спрашивать для выбранных разрядов', () => {
  assert.deepEqual(toursOf([1, 2, 3, 4]), ['atp', 'wta']);
  assert.deepEqual(toursOf([4, 2]), ['wta']);
  assert.deepEqual(toursOf([1]), ['atp']);
});

test('ymdIn: день в часовом поясе', () => {
  assert.equal(ymdIn(Date.parse('2026-11-13T22:20Z'), 'Europe/Moscow'), '20261114');
  assert.equal(ymdIn(Date.parse('2026-11-13T22:20Z'), 'America/New_York'), '20261113');
});

test('разделы: турнир × разряд, в порядке разрядов из настроек; пустые пропадают', () => {
  const data = board({
    atp: [event('148-2026', 'Stockholm Open', {
      'mens-singles': [comp(1, '2026-11-13T15:00Z', single(FRITZ), single(MUSETTI))],
      'mens-doubles': [],
    })],
    wta: [
      event('382-2026', 'WTA Finals', {
        'womens-singles': [comp(2, '2026-11-13T20:10Z', single(ANDREEVA), single(SHNAIDER))],
        'womens-doubles': [comp(3, '2026-11-13T23:00Z', pair(ERRANI, PAOLINI), pair(SINIAKOVA, TOWNSEND))],
      }),
      { id: '1031-2026', name: 'Austin 125' }, // турнир без разрядов — так бывает
    ],
  });
  assert.deepEqual(build(data).leagues.map((l) => [l.id, l.name, l.country, l.matches.map((m) => m.id)]), [
    ['1:148-2026', 'Stockholm Open', 'ATP · одиночный разряд', [1]],
    ['2:382-2026', 'WTA Finals', 'WTA · одиночный разряд', [2]],
    ['4:382-2026', 'WTA Finals', 'WTA · парный разряд', [3]],
  ]);
  assert.deepEqual(build(data, { settings: resolve({ leagues: [4, 1] }) }).leagues.map((l) => l.id), ['4:382-2026', '1:148-2026']);
  assert.deepEqual(build(data, { settings: resolve({}) }).leagues.map((l) => l.id), ['1:148-2026', '2:382-2026'], 'по умолчанию пар нет');
});

test('день — по часовому поясу; идущий матч, начатый до полуночи, остаётся в сегодняшнем дне', () => {
  const data = finals(
    comp(1, '2026-11-12T22:20Z', single(ANDREEVA), single(SHNAIDER), { state: 'post', sets: [[6], [4]], winner: 0 }),
    comp(2, '2026-11-13T20:10Z', single(SABALENKA), single(SVITOLINA)),
    comp(3, '2026-11-12T23:30Z', single(ANDREEVA), single(SABALENKA), { state: 'in', sets: [[6, 2], [4, 3]] }),
  );
  const ids = (o) => build(data, o).leagues.flatMap((l) => l.matches.map((m) => m.id));
  assert.deepEqual(ids({ tz: 'UTC', now: Date.parse('2026-11-13T00:30Z') }), [3, 2], 'UTC: вчерашний идущий — тоже сегодня');
  assert.deepEqual(ids({ tz: 'UTC', now: Date.parse('2026-11-13T12:00Z'), date: '20261112' }), [1, 3]);
  assert.deepEqual(ids({ tz: 'Europe/Moscow', date: '20261113' }), [1, 3, 2], 'в Москве ночные матчи — уже 13-го');
});

test('имена — как в ESPN; стороны по order; у игрока номер для ★, у пары — номера обоих', () => {
  const m = only(finals(comp(1, '2026-11-13T20:10Z', single(ANDREEVA, { curatedRank: { current: 3 } }), single(SHNAIDER))));
  assert.deepEqual([m.home.name, m.home.id, m.home.seed, m.away.name, m.away.id], ['Mirra Andreeva', 9820, 3, 'Diana Shnaider', 8017]);
  assert.equal(m.home.players[0].ru.name, 'Мирра Андреева', 'русское имя — для сопоставления с эфирами');
  const d = only(build(board({ wta: [event('1', 'X', { 'womens-doubles': [comp(2, '2026-11-13T20:10Z', pair(ERRANI, PAOLINI), pair(SINIAKOVA, TOWNSEND))] })] })));
  assert.deepEqual([d.doubles, d.home.name, d.home.id, d.home.ids, d.away.name], [true, 'Errani / Paolini', null, [636, 2615], 'Siniakova / Townsend']);
});

test('счёт: геймы по сетам, тай-брейк, выигранные сеты, победитель, подача', () => {
  const tb = (value, tiebreak) => ({ value, tiebreak });
  const done = only(finals(comp(1, '2026-11-13T10:00Z', single(ANDREEVA), single(SHNAIDER), { state: 'post', sets: [[4, tb(7, 7), 6], [6, tb(6, 5), 2]], winner: 0 })));
  assert.deepEqual(done.home.sets, [{ games: 4, tiebreak: null }, { games: 7, tiebreak: 7 }, { games: 6, tiebreak: null }]);
  assert.deepEqual([done.home.score, done.away.score, done.home.winner, done.away.winner], [2, 1, true, false]);
  assert.deepEqual([done.started, done.finished, done.reason, done.liveTime], [true, true, 'Оконч.', null]);

  const live = only(finals(comp(1, '2026-11-13T10:00Z', single(ANDREEVA), single(SHNAIDER), { state: 'in', sets: [[6, 2], [4, 3]], serving: 1 })));
  assert.deepEqual([live.home.score, live.away.score], [1, 0], 'идущий сет никем не выигран');
  assert.deepEqual([live.started, live.finished, live.liveTime, live.home.serving, live.away.serving], [true, false, '2-й сет', false, true]);

  const soon = only(finals(comp(1, '2026-11-13T10:00Z', single(ANDREEVA), single(SHNAIDER))));
  assert.deepEqual([soon.started, soon.home.score, soon.home.sets, soon.timeKnown], [false, null, [], true]);
});

test('статусы: отказ, неявка, отмена, пауза; раунды по-русски', () => {
  const st = (name, state = 'post', round = 'Final') => only(finals(comp(1, '2026-11-13T10:00Z', single(ANDREEVA), single(SHNAIDER), { state, name, round })));
  assert.equal(st('STATUS_RETIRED').reason, 'Отказ');
  assert.equal(st('STATUS_WALKOVER').reason, 'Неявка');
  assert.deepEqual([st('STATUS_CANCELED').cancelled, st('STATUS_CANCELED').finished, st('STATUS_CANCELED').reason], [true, false, 'Отмена']);
  assert.equal(st('STATUS_POSTPONED', 'pre').reason, 'Перенос');
  assert.equal(st('STATUS_SUSPENDED', 'in').liveTime, 'Пауза');
  const round = (text) => st('STATUS_FINAL', 'post', text).round;
  assert.deepEqual(['Semifinal', 'Group Stage', 'Round 2', 'Round of 16', 'Qualifying Final', 'Third Place'].map(round),
    ['Полуфинал', 'Групповой этап', '2-й круг', '1/8 финала', 'Финал квалификации', 'Third Place']);
});

test('соперник не определён; время не назначено — такие матчи в конце; оба не определены — матча нет', () => {
  const day = build(finals(
    comp(1, '2026-11-13T05:00Z', tbd(), single(SHNAIDER), { timeValid: false }),
    comp(2, '2026-11-13T20:10Z', single(SABALENKA), single(SVITOLINA)),
    comp(3, '2026-11-13T05:00Z', tbd(), tbd()),
  ));
  const [known, open] = day.leagues[0].matches;
  assert.deepEqual([known.id, open.id, day.leagues[0].matches.length], [2, 1, 2]);
  assert.deepEqual([open.timeKnown, open.home.name, open.home.id, open.home.ids], [false, 'Не определён', null, []]);
});

test('избранное: ★ игрока — и в одиночном матче, и в паре; 🔔 матча', () => {
  const data = board({ wta: [event('1', 'X', {
    'womens-singles': [comp(1, '2026-11-13T10:00Z', single(ANDREEVA), single(SHNAIDER)), comp(2, '2026-11-13T12:00Z', single(SABALENKA), single(SVITOLINA))],
    'womens-doubles': [comp(3, '2026-11-13T14:00Z', pair(ERRANI, PAOLINI), pair(SINIAKOVA, TOWNSEND))],
  })] });
  const utcTime = new Date(Date.now() + 3600e3).toISOString();
  const settings = resolve({ ...ALL, favorites: [{ id: 8017, name: 'Diana Shnaider' }, { id: 2615, name: 'Jasmine Paolini' }], favoriteMatches: [{ id: 2, name: 'x', utcTime }] });
  const flags = build(data, { settings }).leagues.flatMap((l) => l.matches.map((m) => [m.id, m.favorite, m.remind]));
  assert.deepEqual(flags, [[1, true, false], [2, true, true], [3, true, false]]);
});

test('эфиры привязываются по русским именам из словаря и по алиасам из настроек', () => {
  const s = (title, url) => ({ title, ...parsePair(title), status: 'started', time: null, url, channel: 'X' });
  const streams = [
    s('Арина Соболенко – Элина Свитолина / Итоговый турнир WTA', 'a'),
    s('Сабаленка х Свитолина | повтор', 'b'),
    s('Перес/Схюрс — Эррани/Паолини | WTA Finals', 'c'),
  ];
  const m = only(build(finals(comp(1, '2026-11-13T20:10Z', single(SABALENKA), single(SVITOLINA))), { snapshot: { streams } }));
  assert.deepEqual(m.streams.map((x) => x.url), ['a', 'b']);
});

test('ответ неожиданной формы — ошибка формата, а не пустой день', () => {
  const bad = (ev) => () => build(board({ wta: [ev] }));
  assert.throws(bad({ id: '1', name: 'X', groupings: [{ competitions: [] }] }), /ESPN изменил формат ответа \(у турнира 1 разряд без названия или матчей\)/);
  assert.throws(bad(event('1', 'X', { 'womens-singles': [{ id: '7', competitors: [] }] })), /у матча 7 нет времени, статуса или участников/);
  assert.equal(build(board({ wta: [], atp: [] })).leagues.length, 0);
});
