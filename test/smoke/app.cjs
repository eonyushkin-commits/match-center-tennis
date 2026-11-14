// Проверки в настоящем приложении: главный процесс как есть, сеть подставная, профиль временный.
// Запуск: npm run smoke (scripts/smoke.mjs передаёт --user-data-dir и --smoke-out).
const { app, BrowserWindow, net, session, shell } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { create: fakeNet } = require('./fake-net.cjs');
const playerHtml = require('./vk-player.cjs');
const networkFetch = net.fetch.bind(net);

const OUT = app.commandLine.getSwitchValue('smoke-out');
const results = [];
const save = (extra = {}) => fs.writeFileSync(OUT, JSON.stringify({ results, ...extra }, null, 1));

const external = []; // что приложение хотело открыть в браузере
shell.openExternal = async (url) => { external.push(url); };
const fake = fakeNet();
net.fetch = fake;
globalThis.fetch = fake; // ESPN приложение спрашивает встроенным fetch Node.js
// окно, закрытое другими окнами, Chromium считает скрытым — проверкам это мешает
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
// подсказку про трей не показываем — это настоящее уведомление Windows
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({ ui: { trayHintShown: true } }));
require('../../src/electron/main.cjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (w, code) => w.webContents.executeJavaScript(`(async () => (${code}))()`);
async function until(what, check, ms = 15000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await check()) return;
  throw new Error(`не дождались: ${what}`);
}
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: e.stack || e.message });
  }
  save();
}

app.on('quit', () => save({ quit: true }));
app.whenReady().then(async () => {
  session.fromPartition('matchcenter').protocol.handle('https', (request) => {
    const url = new URL(request.url);
    if (url.hostname === 'vkvideo.ru' && url.pathname === '/video_ext.php') {
      return new Response(playerHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    return networkFetch(request, { bypassCustomProtocolHandlers: true });
  });
  // сколько раз страница подписывалась на ленту
  let subscriptions = 0;
  session.fromPartition('matchcenter').webRequest.onBeforeRequest((d, cb) => {
    if (d.url.includes('/api/events')) subscriptions++;
    cb({});
  });
  let win;
  await until('главное окно', () => (win = BrowserWindow.getAllWindows()[0]) && !win.webContents.isLoading() && win.webContents.getURL().startsWith('http'));
  const page = (code) => js(win, code);
  const on = (code, what, ms) => until(what || code, () => page(code), ms);
  const click = (selector) => page(`document.querySelector(${JSON.stringify(selector)}).click(), true`);
  const players = () => BrowserWindow.getAllWindows().filter((w) => w !== win);
  const audioReady = (w, muted) => until('начальная громкость плеера', async () =>
    !w.webContents.isAudioMuted() && await js(w, `window.playerState?.volume === 0.5 && window.playerState?.muted === ${muted}`));
  const frame = (w = win) => js(w, `document.querySelector('iframe')?.src ?? null`);

  await step('запуск в трей: окно скрыто, страница не подписана на ленту', async () => {
    await sleep(1500);
    assert.equal(win.isVisible(), false);
    assert.equal(await page('document.hidden'), true);
    assert.equal(subscriptions, 0);
  });

  await step('показ окна: расписание загружено, идущий матч — в блоке «Идут сейчас»', async () => {
    win.showInactive();
    await on(`document.querySelectorAll('[data-key^="m:"]').length === 3`, 'три матча в списке');
    assert.equal(subscriptions, 1);
    // каналы дочитываются позже расписания: эфиры появляются сами, без запроса со страницы
    await on(`/эфиров/.test(document.querySelector('#status-text').textContent)`, 'статус каналов');
    await on(`!!document.querySelector('[data-key="m:101"] .stream[data-play]')`, 'эфиры у матча');
    assert.ok(await page(`!!document.querySelector('[data-key="live"] [data-key="live:101"]')`));
    assert.equal(await page(`document.querySelector('[data-key="m:101"] .name').textContent`), 'Mirra Andreeva');
    assert.equal(await page(`[...document.querySelectorAll('[data-key="m:101"] .team:first-child .set')].map((n) => n.textContent).join(' ')`), '6 2');
  });

  // каналы перечитываются раз в минуту, так что за несколько секунд новый эфир покажет только кнопка
  const streamsOf103 = (n) => on(`document.querySelectorAll('[data-key="m:103"] .stream[data-play]').length === ${n}`, `эфиров у матча 103: ${n}`, 6000);

  await step('кнопка ↻: каналы перечитываются, новый эфир появляется сразу', async () => {
    fake.addStream('tennisprimesport', 1);
    fake.addStream('sportcast_tennis', 2);
    await click('#refresh');
    await streamsOf103(2);
    await on(`!document.querySelector('#refresh').classList.contains('spin')`, 'значок перестал крутиться');
  });

  await step('эфир открывается напрямую в защищённом окне VK', async () => {
    for (const src of ['https://example.com/video_ext.php', 'http://vkvideo.ru/video_ext.php', 'https://vkvideo.ru/other']) {
      await page(`window.mc.openPlayer({src:${JSON.stringify(src)}})`);
    }
    assert.equal(players().length, 0, 'IPC отклоняет посторонние адреса');
    await click('[data-key="live:101"] .stream[data-play]');
    await until('окно эфира', () => players().length === 1 && players()[0].webContents.getURL().includes('video_ext.php'));
    const child = players()[0];
    assert.match(child.webContents.getURL(), /oid=-1&id=1&/);
    assert.equal(child.isAlwaysOnTop(), true);
    const prefs = child.webContents.getLastWebPreferences();
    assert.equal(prefs.nodeIntegration, false);
    assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.sandbox, true);
    assert.equal(child.webContents.session.isSpellCheckerEnabled(), false);
    assert.equal(await js(child, `localStorage.getItem('vk_player_preferred_default_quality_settings')`), '{"type":"high_quality"}');
    assert.equal(await js(child, 'window.qualityAtStart'), '{"type":"high_quality"}', 'настройка записана до скриптов плеера');
    assert.equal(await js(child, 'typeof require + typeof process'), 'undefinedundefined');
    assert.equal(new URL(child.webContents.getURL()).searchParams.get('mute'), '0');
    assert.equal(new URL(child.webContents.getURL()).searchParams.get('js_api'), '1');
    await audioReady(child, false);
    // Инициализация не должна сбрасывать последующие ручные изменения.
    await js(child, `window.postMessage({method:'set_volume',volume:0.2},location.origin), true`);
    await sleep(350);
    assert.equal(await js(child, 'window.playerState.volume'), 0.2);
    assert.equal(await frame(), null);
  });
  await step('запись открывается вторым самостоятельным плеером', async () => {
    await click('[data-key="m:102"] .stream[data-play]');
    await until('два окна', () => players().length === 2 && players().some(w => /id=2&/.test(w.webContents.getURL())));
    const second = players().find(w => /id=2&/.test(w.webContents.getURL()));
    await audioReady(second, true);
    assert.equal(new URL(second.webContents.getURL()).searchParams.get('mute'), '1');
    await click('[data-key="m:102"] .stream[data-play]');
    await until('три окна', () => players().length === 3 && players().filter(w => /id=2&/.test(w.webContents.getURL())).length === 2);
    const third = players().find(w => w !== second && /id=2&/.test(w.webContents.getURL()));
    await audioReady(third, true);
    await js(second, `window.postMessage({method:'unmute'},location.origin), true`);
    await sleep(350);
    assert.equal(await js(second, 'window.playerState.muted'), false, 'звук можно включить в VK');
    assert.equal(await js(third, 'window.playerState.muted'), true, 'третье окно остаётся без звука');
    assert.equal(await js(players().find(w => w !== second && w !== third), 'window.playerState.volume'), 0.2);
    for (const w of players()) if (/id=2&/.test(w.webContents.getURL())) w.close();
    await until('осталось окно эфира', () => players().length === 1);
    assert.equal(await frame(), null);
  });

  await step('после закрытия всех плееров новое окно снова со звуком 50%', async () => {
    for (const w of players()) w.close();
    await until('все плееры закрыты', () => players().length === 0);
    await click('[data-key="live:101"] .stream[data-play]');
    await until('новое первое окно', () => players().length === 1);
    await audioReady(players()[0], false);
  });

  await step('окна не уходят на чужой сайт: такая ссылка открывается в браузере', async () => {
    const child = players()[0];
    const before = child.webContents.getURL();
    await js(child, `location.href = 'https://vkvideo.ru/@tennis_bolshe', true`);
    await js(win, `location.href = 'https://example.com/', true`);
    await until('ссылки ушли в браузер', () => external.includes('https://vkvideo.ru/@tennis_bolshe') && external.includes('https://example.com/'));
    assert.equal(child.webContents.getURL(), before);
    assert.ok(win.webContents.getURL().startsWith('http://127.0.0.1:'));
  });

  await step('настройки открываются сразу: пять каналов и четыре разряда', async () => {
    await click('#open-settings');
    assert.equal(await page(`document.querySelector('#settings').open`), true);
    const labels = await page(`[...document.querySelectorAll('#settings input[name="league"]')].map((i) => i.closest('label').textContent.trim())`);
    assert.deepEqual(labels, ['Мужчины · одиночный разряд', 'Женщины · одиночный разряд', 'Мужчины · парный разряд', 'Женщины · парный разряд']);
    assert.deepEqual(await page(`[...document.querySelectorAll('#settings input[name="league"]')].map((i) => i.checked)`), [true, true, false, false], 'пары по умолчанию выключены');
    assert.equal(await page(`document.querySelectorAll('#settings #chan-list li').length`), 5);
    await page(`document.querySelector('#settings').close(), true`);
  });

  await step('«Скопировать отчёт» в панели каналов: отчёт в буфере обмена, без имени пользователя', async () => {
    const { clipboard } = require('electron');
    // буфер обмена общий с системой — вернём как было; в Electron 44 он асинхронный
    const saved = await clipboard.readText().catch(() => null);
    try {
      await clipboard.writeText('');
      await click('#status');
      await click('#status-pop [data-action="diagnostics"]');
      await until('кнопка подтвердила копирование', () => page(`document.querySelector('#status-pop [data-action="diagnostics"]')?.textContent === 'Отчёт скопирован'`));
      const report = await clipboard.readText();
      assert.match(report, /^Матч-центр Теннис — диагностический отчёт/);
      assert.match(report, new RegExp(`Версия: ${app.getVersion().replaceAll('.', '\\.')} \\(запуск из исходников\\)`));
      assert.match(report, /ESPN:\n {2}atp: последний успех \d{4}-/);
      assert.match(report, /ok {3}tennisprimesport: через api/);
      const user = require('node:os').userInfo().username;
      if (user.length > 2) assert.ok(!report.toLowerCase().includes(user.toLowerCase()), 'в отчёте нет имени пользователя');
      await page(`document.body.click(), true`);
    } finally {
      if (typeof saved === 'string') await clipboard.writeText(saved).catch(() => {});
    }
  });

  await step('клик по уведомлению: скрытое окно показывается и открывает идущий матч в плеере', async () => {
    win.hide();
    await sleep(300);
    const { ymdIn } = await import('../../src/core/day.mjs');
    win.showInactive(); // как openMatch в main.cjs: показать окно и попросить страницу раскрыть матч
    win.webContents.send('open-match', { date: ymdIn(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone), id: 101 });
    await until('окно из уведомления', () => players().length === 2);
    assert.equal(win.isVisible(), true);
  });

  await step('крестик прячет окно в трей: приложение работает, лента закрыта и открывается при показе', async () => {
    for (const w of players()) w.destroy();
    assert.equal(await frame(), null);
    win.close();
    await sleep(500);
    assert.equal(win.isDestroyed(), false);
    assert.equal(win.isVisible(), false);
    const before = subscriptions;
    win.showInactive();
    await until('новая подписка при показе', () => subscriptions === before + 1);
    win.close();
    await sleep(300);
  });

  setTimeout(() => app.exit(1), 5000).unref(); // «Выход» не сработал — runner увидит, что quit не записан
  app.quit();
}).catch((e) => {
  results.push({ name: 'запуск проверок', ok: false, error: String(e.message) });
  save();
  app.exit(1);
});
