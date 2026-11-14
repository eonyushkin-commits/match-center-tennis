import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReport, coreDiagnostics, sanitize } from '../src/core/diagnostics.mjs';
import { createEspn } from '../src/core/espn.mjs';
import { resolve } from '../src/core/settings.mjs';
import { createStreamPoller } from '../src/core/streams.mjs';
import { popoverHtml } from '../src/web/view.mjs';

const PATHS = [
  ['<userData>', 'C:\\Users\\Ivan Petrov\\AppData\\Roaming\\tennis-center'],
  ['<appData>', 'C:\\Users\\Ivan Petrov\\AppData\\Roaming'],
  ['~', 'C:\\Users\\Ivan Petrov'],
];

test('sanitize: известные папки — подписями, в обоих написаниях и любом регистре; длинный путь первым', () => {
  const s = sanitize('Копия: C:\\Users\\Ivan Petrov\\AppData\\Roaming\\tennis-center\\settings.broken.json; c:/users/ivan petrov/Desktop/x.txt', { replace: PATHS });
  assert.equal(s, 'Копия: <userData>\\settings.broken.json; ~/Desktop/x.txt');
});

test('sanitize: чужие домашние папки и file://-адреса не выдают имя пользователя', () => {
  const s = sanitize('D:\\Users\\olga\\a.txt C:/Documents and Settings/petr/b /home/anna/c /Users/bob/d file:///C:/Users/olga/e.html');
  assert.doesNotMatch(s, /olga|petr|anna|bob/);
  assert.match(s, /D:\\Users\\<user>\\a\.txt/);
  assert.match(s, /\/home\/<user>\/c/);
});

test('sanitize: у URL отрезаются параметры и якорь; токены, подписи, Bearer и e-mail скрыты', () => {
  const s = sanitize([
    'GET https://vkvideo.ru/video_ext.php?oid=-1&id=2&hash=abc&sig=deadbeef не ответил',
    'https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard#x',
    'access_token=vk1.a.SECRET client_secret: o557 "token":"abc" Authorization: Bearer eyJhbGci.x.y',
    'пишите на ivan.petrov+t@mail.example.ru',
  ].join('\n'));
  assert.match(s, /https:\/\/vkvideo\.ru\/video_ext\.php\?… не ответил/);
  assert.match(s, /tennis\/atp\/scoreboard\?…/);
  assert.doesNotMatch(s, /deadbeef|hash=|SECRET|o557|"abc"|eyJ|ivan/);
  assert.match(s, /access_token=<скрыто>/);
  assert.match(s, /Bearer <скрыто>/);
  assert.match(s, /<e-mail>/);
});

test('sanitize: обычный текст ошибок не портится', () => {
  const text = 'api: catalog.getVideo: Access denied; страница: нет ответа за 45 с (доступ не из России?)';
  assert.equal(sanitize(text, { replace: PATHS }), text);
});

const quiet = { warn() {}, error() {} };
const APP = { name: 'Матч-центр Теннис', version: '1.0.6', packaged: true, electron: '44.4.4', chrome: '140', node: '24', os: 'Windows_NT 10.0.26300 x64' };

function core({ user = {}, warnings = [], readers, espnFetch } = {}) {
  const s = resolve(user);
  const settings = { get: () => s, warnings };
  const poller = createStreamPoller({ channels: () => s.channels.filter((c) => c.enabled), intervalMs: () => 1e9, readers, log: quiet });
  const espn = createEspn(espnFetch);
  return { settings, poller, espn };
}

test('отчёт: версия, ОС, счётчики настроек, ESPN по турам и каналы; свои каналы и имена игроков не попадают', async () => {
  const user = {
    channels: [{ screenName: 'my_secret_channel', label: 'Канал Ивана' }],
    favorites: [{ id: 1, name: 'Andreeva' }],
    teamAliases: { Andreeva: ['Мирра'] },
  };
  const err = new Error('VK: HTTP 500 https://api.vkvideo.ru/method/catalog.getVideo?access_token=XYZ, https://vkvideo.ru/@my_secret_channel/lives; Канал Ивана');
  const readers = [{ name: 'api', read: async (ch) => { if (ch.screenName === 'my_secret_channel') throw err; return []; } }];
  const espnFetch = async (url) => {
    if (url.includes('/wta/')) throw new Error('fetch failed');
    return new Response(JSON.stringify({ events: [] }));
  };
  const deps = core({ user, warnings: ['Файл настроек повреждён, копия: C:\\Users\\Ivan Petrov\\AppData\\Roaming\\tennis-center\\settings.broken-1.json'], readers, espnFetch });
  await deps.poller.refresh();
  deps.poller.stop();
  await deps.espn.day('20261113', ['atp']);
  await deps.espn.day('20261113', ['wta']).catch(() => {});

  const report = buildReport({
    app: APP,
    core: coreDiagnostics({ ...deps, now: Date.parse('2026-11-14T12:00:00Z') }),
  }, { paths: PATHS });

  assert.match(report, /^Матч-центр Теннис — диагностический отчёт\nСоздан: 2026-11-14T12:00:00Z/);
  assert.match(report, /Версия: 1\.0\.6 \(установленная\)/);
  assert.match(report, /ОС: Windows_NT 10\.0\.26300 x64/);
  assert.match(report, /каналов: 6, включено: 6, своих: 1/);
  assert.match(report, /избранных игроков: 1; отмеченных матчей: 0; своих написаний: 1/);
  assert.match(report, /atp: последний успех \d{4}-\d\d-\d\dT[\d:]+Z; последняя ошибка нет/);
  assert.match(report, /wta: последний успех —; последняя ошибка [\dT:Z-]+ — fetch failed/);
  assert.match(report, /ok {3}tennisprimesport: через api, эфиров 0/);
  assert.match(report, /сбой свой канал 1: эфиров 0/);
  assert.match(report, /ошибка: api: VK: HTTP 500 https:\/\/api\.vkvideo\.ru\/method\/catalog\.getVideo\?… https:\/\/vkvideo\.ru\/@свой канал 1\/lives; свой канал 1/);
  assert.match(report, /копия: <userData>\\settings\.broken-1\.json/);
  assert.doesNotMatch(report, /my_secret_channel|Канал Ивана|Andreeva|Мирра|Ivan|XYZ/);
});

test('отчёт: неудачи запасного чтения и пауза канала', async () => {
  const fail = async () => { throw new Error('нет'); };
  const deps = core({ user: { channels: [] }, readers: [{ name: 'api', read: fail }, { name: 'страница', read: fail }] });
  await deps.poller.refresh();
  deps.poller.stop();
  const d = coreDiagnostics({ ...deps });
  const ch = d.vk.channels[0];
  assert.equal(ch.fails, 1);
  assert.ok(ch.pausedUntil > d.now);
  assert.match(buildReport({ app: APP, core: d }), /неудач запасного чтения подряд 1, запасное чтение на паузе до /);
});

test('ESPN: время успеха меняется только настоящим ответом, а не чтением кэша; ошибка не стирает прошлый успех', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  let down = false;
  const e = createEspn(async () => {
    if (down) throw new Error('нет сети');
    return new Response(JSON.stringify({ events: [] }));
  });
  await e.day('20261113', ['atp']);
  const okAt = e.health()[0].okAt;
  assert.equal(okAt, 1_000_000);
  t.mock.timers.tick(10e3);
  await e.day('20261113', ['atp']); // из кэша
  assert.equal(e.health()[0].okAt, okAt);
  down = true;
  e.refresh();
  t.mock.timers.tick(10e3);
  const day = await e.day('20261113', ['atp']);
  assert.ok(day.stale);
  const h = e.health()[0];
  assert.deepEqual([h.tour, h.okAt, h.errorAt, h.error], ['atp', okAt, 1_020_000, 'нет сети']);
});

test('отчёт: свой канал заменяется только целым словом — название приложения и встроенные каналы целы', () => {
  const s = resolve({ channels: [{ screenName: 'tennis', label: 'Теннис' }] });
  const poller = createStreamPoller({ channels: () => s.channels, intervalMs: () => 1e9, readers: [], log: quiet });
  const report = buildReport({ app: APP, core: coreDiagnostics({ settings: { get: () => s, warnings: [] }, poller, espn: createEspn() }) });
  assert.match(report, /^Матч-центр Теннис — диагностический отчёт/);
  assert.match(report, /ждёт tennisprimesport:/);
  assert.match(report, /ждёт свой канал 1:/);
  assert.doesNotMatch(report, /ждёт tennis:/);
});

test('панель каналов: кнопка отчёта только в приложении, подпись по состоянию', () => {
  const vk = { ready: true, channels: [] };
  assert.doesNotMatch(popoverHtml(vk, 60), /diagnostics/);
  assert.match(popoverHtml(vk, 60, 'idle'), /data-action="diagnostics"[^>]*>Скопировать отчёт</);
  assert.match(popoverHtml(vk, 60, 'done'), />Отчёт скопирован</);
  assert.match(popoverHtml(vk, 60, 'failed'), />Не удалось скопировать</);
});
