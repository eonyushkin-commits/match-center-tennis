// Логика и разметка страницы — без браузера: src/web/*.mjs не трогают DOM.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markFavorites, scoresHidden, sections } from '../src/web/filter.mjs';
import { addDays, audience, embedUrl, esc, parseAliases, parseChannel, dateStrip, inDateRange } from '../src/web/format.mjs';
import { notices, rowHtml, sectionHeadHtml, statusBadge, updateHtml } from '../src/web/view.mjs';

const stream = (o) => ({ status: 'started', channel: 'Sportcast', title: 'Синнер — Алькарас', url: 'https://vkvideo.ru/video-1_2', embed: 'https://vkvideo.ru/video_ext.php?oid=-1&id=2&hash=h', ...o });
// сторона матча: игрок (id — номер для ★) или пара (id нет, ids — оба)
const side = (id, name, o = {}) => ({ id, ids: id == null ? [] : [id], name, players: [{ id, name, flag: 'https://a.espncdn.com/x.png' }], seed: null, sets: [], score: null, winner: false, serving: false, ...o });
const games = (...list) => list.map((g) => (typeof g === 'object' ? g : { games: g, tiebreak: null }));
const match = (o = {}) => ({
  id: 1, utcTime: '2026-09-20T14:00:00Z', timeKnown: true, doubles: false, round: 'Финал', court: 'Center Court',
  started: false, finished: false, cancelled: false,
  home: side(10, 'Jannik Sinner'), away: side(20, 'Carlos Alcaraz'), streams: [], ...o,
});
const view = (o = {}) => ({ favIds: new Set(), hidden: () => false, ...o });
const row = (m) => rowHtml({ key: `m:${m.id}`, m, lg: { name: 'ATP Finals', country: 'Мужчины · одиночный разряд' } }, view());

// ---------- format ----------
test('esc экранирует всё, что ломает разметку', () => {
  assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
});

test('addDays переходит через месяц и год', () => {
  assert.equal(addDays('20261231', 1), '20270101');
  assert.equal(addDays('20260301', -1), '20260228');
});

test('dateStrip: семь дней, сегодня в середине, сдвиг на день — только за краем', () => {
  const strip = (date, start) => { const r = dateStrip('20260925', date, start); return [r.start.slice(4), r.days.map((d) => d.date.slice(6)).join(' ')]; };
  assert.deepEqual(strip('20260925', null), ['0922', '22 23 24 25 26 27 28'], 'запуск: сегодня в середине');
  assert.deepEqual(strip('20260927', '20260922'), ['0922', '22 23 24 25 26 27 28'], 'клик внутри — полоса на месте');
  assert.deepEqual(strip('20260929', '20260922'), ['0923', '23 24 25 26 27 28 29'], '› с края — сдвиг на день');
  assert.deepEqual(strip('20260921', '20260922'), ['0921', '21 22 23 24 25 26 27'], '‹ с края — сдвиг на день');
  assert.deepEqual(dateStrip('20260925', '20260925', null).days.map((d) => d.offset), [-3, -2, -1, 0, 1, 2, 3]);
});

test('inDateRange: неделя за краями полосы — с 15 сентября по 5 октября', () => {
  assert.equal(inDateRange('20260925', '20260915'), true);
  assert.equal(inDateRange('20260925', '20260914'), false);
  assert.equal(inDateRange('20260925', '20261005'), true);
  assert.equal(inDateRange('20260925', '20261006'), false);
});

test('audience: зрители только у идущего эфира', () => {
  assert.match(audience(stream({ spectators: 1234 })).text, /^ · 1,2\sтыс\. смотрят$/);
  assert.equal(audience(stream({ status: 'finished', spectators: 18557 })), null);
  assert.equal(audience(stream({ spectators: 0 })), null);
});

test('embedUrl: только https-плеер VK, сохраняет параметры официальной ссылки', () => {
  assert.equal(embedUrl(stream({ embed: 'https://vkvideo.ru/video_ext.php?oid=-1&id=2&hash=h&__ref=x' })), 'https://vkvideo.ru/video_ext.php?oid=-1&id=2&hash=h&__ref=x');
  assert.equal(embedUrl(stream({ embed: 'http://vkvideo.ru/video_ext.php' })), null);
  assert.equal(embedUrl(stream({ embed: 'https://evil.example/vkvideo.ru' })), null);
  assert.equal(embedUrl(stream({ embed: 'не ссылка' })), null);
  assert.equal(embedUrl(stream({ embed: null })), null);
});

test('parseChannel понимает ссылки и @имя', () => {
  for (const s of ['vkvideo.ru/@tennis_bolshe', 'https://vkvideo.ru/@tennis_bolshe/lives', 'https://www.vk.com/video/@tennis_bolshe', 'https://vk.ru/tennis_bolshe', '@tennis_bolshe', ' tennis_bolshe '])
    assert.equal(parseChannel(s), 'tennis_bolshe', s);
  assert.equal(parseChannel('https://vkvideo.ru/'), null);
  assert.equal(parseChannel('два слова'), null);
});

test('parseAliases: строки «Игрок = варианты», пустые пропускаются', () => {
  assert.deepEqual(parseAliases('Соболенко = Сабаленка, Арина С.\n\n Samson=Самсон ').aliases,
    { 'Соболенко': ['Сабаленка', 'Арина С.'], Samson: ['Самсон'] });
  assert.match(parseAliases('Синнер').error, /Не понял строку «Синнер»/);
  assert.match(parseAliases('Синнер = ').error, /Синнер =/);
});

// ---------- filter ----------
test('scoresHidden: только в режиме без спойлеров, у начавшихся и не раскрытых', () => {
  const on = { hideScores: true, revealed: new Set() };
  assert.equal(scoresHidden(match({ finished: true }), on), true);
  assert.equal(scoresHidden(match({ started: true }), on), true);
  assert.equal(scoresHidden(match(), on), false);
  assert.equal(scoresHidden(match({ finished: true }), { hideScores: true, revealed: new Set([1]) }), false);
  assert.equal(scoresHidden(match({ finished: true }), { hideScores: false, revealed: new Set() }), false);
});

test('markFavorites: ★ игрока (и в паре) и 🔔 матча делают матч избранным', () => {
  const a = match({ id: 1 });
  const b = match({ id: 2, home: side(30, 'Taylor Fritz'), away: side(40, 'Ben Shelton') });
  const c = match({ id: 3, home: side(50, 'Casper Ruud'), away: side(60, 'Tommy Paul') });
  const d = match({ id: 4, doubles: true, home: side(null, 'Errani / Paolini', { ids: [70, 20] }), away: side(null, 'Perez / Schuurs', { ids: [80, 90] }) });
  markFavorites({ leagues: [{ matches: [a, b, c, d] }] }, { favorites: [{ id: 20 }], favoriteMatches: [{ id: 2 }] });
  assert.deepEqual([a, b, c, d].map((m) => [m.favorite, m.remind]), [[true, false], [true, true], [false, false], [true, false]]);
});

function day() {
  const live = match({ id: 1, started: true, streams: [stream()] });
  const liveNoStream = match({ id: 2, started: true, home: side(30, 'Taylor Fritz'), away: side(40, 'Ben Shelton') });
  const later = match({ id: 3, home: side(50, 'Casper Ruud'), away: side(60, 'Tommy Paul', { players: [{ id: 60, name: 'Tommy Paul', ru: { name: 'Томми Пол' } }] }), favorite: true });
  const cup = match({ id: 4, finished: true, home: side(70, 'Mirra Andreeva'), away: side(80, 'Diana Shnaider'), streams: [stream({ status: 'finished' })] });
  return { leagues: [{ id: 47, name: 'ATP Finals', country: 'Мужчины · одиночный разряд', matches: [live, liveNoStream, later] }, { id: 132, name: 'WTA Finals', country: 'Женщины · одиночный разряд', matches: [cup] }] };
}
const NO = { streams: false, live: false, favorites: false };
const keys = (secs) => secs.map((s) => `${s.key}=${s.rows.map((r) => r.m.id).join(',')}`);
const pick = (o) => keys(sections({ day: day(), isToday: true, filters: NO, q: '', ...o }));

test('sections: «Сейчас в эфире» — сегодня, только матчи с идущим эфиром', () => {
  assert.deepEqual(pick({}), ['live=1', 'lg:47=1,2,3', 'lg:132=4']);
  assert.deepEqual(pick({ isToday: false }), ['lg:47=1,2,3', 'lg:132=4']);
});

test('sections: фильтры и поиск, пустой турнир пропадает', () => {
  assert.deepEqual(pick({ filters: { ...NO, streams: true } }), ['live=1', 'lg:47=1', 'lg:132=4']);
  assert.deepEqual(pick({ filters: { ...NO, live: true } }), ['lg:47=1,2']); // без блока «Сейчас в эфире»
  assert.deepEqual(pick({ filters: { ...NO, favorites: true } }), ['lg:47=3']);
  assert.deepEqual(pick({ q: '  RUUD ' }), ['lg:47=3']);
  assert.deepEqual(pick({ q: 'томми пол' }), ['lg:47=3'], 'по русскому имени из словаря');
  assert.deepEqual(pick({ q: 'wta' }), ['lg:132=4']);
  const d = day();
  d.leagues[1].level = 'WTA Finals';
  assert.deepEqual(keys(sections({ day: d, isToday: false, filters: NO, q: 'finals' })).length, 2);
  d.leagues[0].level = 'ATP 500';
  assert.deepEqual(keys(sections({ day: d, isToday: false, filters: NO, q: '500' })), ['lg:47=1,2,3'], 'поиск по уровню турнира');
});

test('sections: по времени начала — матчи по времени, одновременные стоят блоком своего турнира', () => {
  const at = (id, time, o) => match({ id, utcTime: `2026-09-20T${time}:00Z`, ...o });
  const d = { leagues: [
    { id: 47, name: 'ATP Finals', country: 'ATP', matches: [at(1, '14:00', { favorite: true }), at(2, '14:00'), at(6, '17:00', { favorite: true })] },
    { id: 48, name: 'Stockholm Open', country: 'ATP', matches: [at(3, '12:00'), at(4, '17:00'), at(7, '14:00')] },
    { id: 132, name: 'WTA Finals', country: 'WTA', matches: [at(5, '14:30')] },
  ] };
  const of = (o) => keys(sections({ day: d, isToday: false, filters: NO, q: '', ...o }));
  assert.deepEqual(of({}), ['lg:47=1,2,6', 'lg:48=3,4,7', 'lg:132=5']);
  assert.deepEqual(of({ byTime: true }),
    ['lg:48:3=3', 'lg:47:1=1,2', 'lg:48:7=7', 'lg:132:5=5', 'lg:47:6=6', 'lg:48:4=4'],
    '14:30 идёт после 14:00 и до 17:00; при равном времени — порядок из настроек');
  assert.deepEqual(of({ byTime: true, filters: { ...NO, favorites: true } }), ['lg:47:1=1,6'], 'соседние блоки одного турнира — один раздел');
  d.leagues[2].matches.unshift(at(8, '00:00', { timeKnown: false }));
  assert.deepEqual(of({ byTime: true }).slice(-2), ['lg:48:4=4', 'lg:132:8=8'], 'матч без назначенного времени — в конце списка');
});

// ---------- view: строка матча ----------
test('sectionHeadHtml: турнир с разрядом и числом матчей', () => {
  assert.equal(sectionHeadHtml({ lg: { name: 'WTA <Finals>', country: 'Женщины · парный разряд' }, rows: [1, 2] }),
    'WTA &lt;Finals&gt; <small>Женщины · парный разряд</small><span class="count">2</span>');
  assert.match(sectionHeadHtml({ live: true, rows: [1] }), /^Сейчас в эфире/);
  assert.equal(sectionHeadHtml({ lg: { name: 'Brisbane', level: 'WTA 500', country: 'Женщины · одиночный разряд' }, rows: [1] }),
    'Brisbane <span class="level">WTA 500</span> <small>Женщины · одиночный разряд</small><span class="count">1</span>', 'уровень турнира — в шапке');
});

test('rowHtml: статус, у будущего — время и колокольчик; время не назначено — прочерк без колокольчика', () => {
  assert.match(row(match({ started: true, finished: true, reason: 'Отказ' })), /<div class="when">Отказ/);
  assert.match(row(match({ started: true, liveTime: '2-й сет' })), /<div class="when live">2-й сет/);
  assert.match(row(match({ cancelled: true, reason: 'Перенос' })), /Перенос/);
  assert.match(row(match()), /data-remind/);
  assert.doesNotMatch(row(match({ started: true })), /data-remind/);
  assert.match(row(match({ remind: true })), /class="bell on"/);
  const open = row(match({ timeKnown: false }));
  assert.match(open, /<div class="when">—<\/div>/);
  assert.doesNotMatch(open, /data-remind/);
});

test('rowHtml: счёт по сетам с тай-брейком, победитель, подача, посев, раунд и корт', () => {
  const done = row(match({ started: true, finished: true,
    home: side(10, 'Jannik Sinner', { sets: games(6, { games: 7, tiebreak: 7 }), winner: true, seed: 1 }),
    away: side(20, 'Carlos Alcaraz', { sets: games(4, { games: 6, tiebreak: 5 }) }) }));
  assert.match(done, /class="team win">[\s\S]*<small class="seed" title="Номер посева">1<\/small><span class="name">Jannik Sinner<\/span>/, 'посев — перед именем');
  assert.match(done, /<small class="seed"><\/small><span class="name">Carlos Alcaraz<\/span>/, 'у несеяного — пустое место той же ширины');
  assert.doesNotMatch(row(match()), /class="seed"/, 'никто не посеян — места под номер нет');
  assert.match(done, /<span class="set">6<\/span><span class="set">7<sup>7<\/sup><\/span>/);
  assert.match(done, /<span class="set">4<\/span><span class="set">6<sup>5<\/sup><\/span>/);
  const won = row(match({ finished: true, home: side(10, 'Jannik Sinner', { sets: [{ games: 3 }, { games: 6, won: true }] }), away: side(20, 'Carlos Alcaraz', { sets: [{ games: 6, won: true }, { games: 3 }], winner: true }) }));
  assert.match(won, /<span class="set">3<\/span><span class="set won">6<\/span>/, 'выделен выигранный сет, а не вся строка победителя');
  assert.match(won, /<span class="set won">6<\/span><span class="set">3<\/span>/);
  assert.equal(done.match(/class="team win"/g).length, 1);
  assert.match(done, /^<div class="lg-tag meta">Финал · Center Court<\/div><div class="when">/, 'раунд и корт — строкой над игроками');
  const inLive = rowHtml({ key: 'live:1', m: match(), lg: { name: 'ATP Finals', country: 'Мужчины · одиночный разряд' }, showLeague: true }, view());
  assert.match(inLive, /^<div class="lg-tag">ATP Finals · Мужчины · одиночный разряд<\/div><div class="lg-tag meta">Финал · Center Court<\/div>/, 'в «Сейчас в эфире» — второй строкой под турниром');
  assert.doesNotMatch(row(match({ round: '', court: null })), /lg-tag/);
  const live = row(match({ started: true, liveTime: '1-й сет', home: side(10, 'Jannik Sinner', { sets: games(2) }), away: side(20, 'Carlos Alcaraz', { sets: games(3), serving: true }) }));
  assert.equal(live.match(/class="serve"/g).length, 1);
  assert.doesNotMatch(row(match()), /class="sets"|class="serve"/, 'у не начавшегося матча счёта нет');
});

test('rowHtml: пара — флаги обоих, ★ нет', () => {
  const html = row(match({ doubles: true,
    home: side(null, 'Errani / Paolini', { ids: [1, 2], players: [{ id: 1, name: 'Sara Errani', flag: 'https://a.espncdn.com/ita.png' }, { id: 2, name: 'Jasmine Paolini', flag: 'https://a.espncdn.com/ita.png' }] }) }));
  assert.match(html, /<span class="flags"><img[^>]*ita\.png[^>]*><img[^>]*ita\.png[^>]*><\/span>\s*<span class="name">Errani \/ Paolini/);
  assert.equal(html.match(/data-fav=/g).length, 1, '★ только у игрока одиночной стороны');
});

test('rowHtml: без спойлеров вместо счёта «?», победитель и подача не видны', () => {
  const m = match({ started: true, finished: true,
    home: side(10, 'Jannik Sinner', { sets: games(6, 6), winner: true }), away: side(20, 'Carlos Alcaraz', { sets: games(3, 4), serving: true }) });
  const open = rowHtml({ key: 'm:1', m, lg: {} }, view());
  assert.match(open, /class="team win"/);
  const hidden = rowHtml({ key: 'm:1', m, lg: {} }, view({ hidden: () => true }));
  assert.doesNotMatch(hidden, /class="sets"|win|class="serve"/);
  assert.equal(hidden.match(/data-reveal="1"/g).length, 2);
});

test('rowHtml: эфиры — зрители только у LIVE, повторы канала нумеруются', () => {
  const html = row(match({ started: true, streams: [stream({ spectators: 1500 }), stream({ status: 'finished', spectators: 9000 })] }));
  assert.match(html, /LIVE<\/span>Sportcast<span class="aud"> · 1,5\sтыс\. смотрят/);
  assert.match(html, /запись<\/span>Sportcast 2<\/a>/);
  assert.equal(html.match(/смотрят/g).length, 1);
});

test('rowHtml: «Искать в VK» только у не сыгранного матча без эфиров', () => {
  assert.match(row(match()), /class="stream find" href="https:\/\/vkvideo\.ru\/search\?q=Jannik%20Sinner%20Carlos%20Alcaraz"/);
  assert.doesNotMatch(row(match({ finished: true })), /Искать в VK|class="streams"/);
});

test('rowHtml: избранные игроки', () => {
  const m = match({ streams: [stream(), stream({ url: 'https://vkvideo.ru/video-1_3' })] });
  const html = rowHtml({ key: 'm:1', m, lg: {} }, view({ favIds: new Set([20]) }));
  assert.match(html, /class="star on" data-fav="20"/);
  assert.match(html, /class="star" data-fav="10"/);

});

test('rowHtml экранирует названия из внешних источников', () => {
  const html = row(match({ home: side(1, '<img src=x onerror=alert(1)>', { players: [{ id: 1, name: 'x', flag: '"><script>' }] }), round: '<i>', streams: [stream({ channel: '<b>', title: '"x"' })] }));
  assert.doesNotMatch(html, /<img src=x|<b>|<i>|<script>/);
});

// ---------- view: полосы и статус ----------
test('updateHtml: «Скачать» → прогресс → «Установить», крестик на каждом шаге', () => {
  assert.match(updateHtml({ state: 'available', version: '3.0.0' }), /Доступна версия 3\.0\.0.*update-download/s);
  assert.match(updateHtml({ state: 'downloading', version: '3.0.0', percent: 37 }), /37%.*value="37"/);
  assert.match(updateHtml({ state: 'ready', version: '3.0.0' }), /update-install/);
  for (const state of ['available', 'downloading', 'ready', 'error'])
    assert.match(updateHtml({ state, version: '3.0.0', error: 'x' }), /data-action="update-dismiss"/, state);
  assert.equal(updateHtml({ state: 'none' }), null);
});

test('notices: обновление первым; крестик прячет полосу до следующего шага', () => {
  const update = { state: 'available', version: '3.0.0' };
  const base = { error: 'сеть', day: {}, status: null, saveError: null, update };
  const kinds = (o) => notices({ ...base, ...o }).map(([cls]) => cls);
  assert.deepEqual(kinds({}), ['update', 'bad']);
  assert.deepEqual(kinds({ updateDismissed: '3.0.0:available' }), ['bad']);
  assert.deepEqual(kinds({ updateDismissed: '3.0.0:downloading', update: { ...update, state: 'downloading', percent: 60 } }), ['bad']);
  assert.deepEqual(kinds({ updateDismissed: '3.0.0:downloading', update: { ...update, state: 'ready' } }), ['update', 'bad']);
  assert.deepEqual(kinds({ updateDismissed: '3.0.0:ready', update: { ...update, state: 'ready' } }), ['bad']);
  assert.deepEqual(kinds({ updateDismissed: '3.0.0:available', update: { ...update, version: '3.0.1' } }), ['update', 'bad']);
});

test('notices: предупреждение, когда не читается ни один канал', () => {
  const vk = (oks) => ({ ready: true, channels: oks.map((ok) => ({ ok })) });
  assert.equal(notices({ status: { vk: vk([false, false]) } }).length, 1);
  assert.equal(notices({ status: { vk: vk([false, true]) } }).length, 0);
});

test('statusBadge: цвет точки по доле упавших каналов', () => {
  const vk = (oks) => ({ ready: true, streamCount: 5, updatedAt: 0, channels: oks.map((ok) => ({ ok })) });
  assert.equal(statusBadge(null).cls, 'wait');
  assert.equal(statusBadge(vk([true, true])).cls, 'ok');
  assert.equal(statusBadge(vk([true, false])).cls, 'warn');
  assert.equal(statusBadge(vk([false, false])).cls, 'bad');
  assert.match(statusBadge(vk([true])).text, /^5 эфиров · /);
});
