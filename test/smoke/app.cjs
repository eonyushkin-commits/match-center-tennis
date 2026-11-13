// Проверки в настоящем приложении: главный процесс как есть, сеть подставная, профиль временный.
// Запуск: npm run smoke (scripts/smoke.mjs передаёт --user-data-dir и --smoke-out).
const { app, BrowserWindow, net, session, shell } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { create: fakeNet } = require('./fake-net.cjs');

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
    results.push({ name, ok: false, error: e.message.split('\n')[0] });
  }
  save();
}

app.on('quit', () => save({ quit: true }));
app.whenReady().then(async () => {
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
    await click('[data-key="live:101"] .stream[data-play]');
    await until('окно эфира', () => players().length === 1 && players()[0].webContents.getURL().includes('video_ext.php'));
    const child = players()[0];
    assert.match(child.webContents.getURL(), /oid=-1&id=1&/);
    assert.equal(child.isAlwaysOnTop(), true);
    const prefs = child.webContents.getLastWebPreferences();
    assert.equal(prefs.nodeIntegration, false);
    assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.sandbox, true);
    assert.ok(!prefs.preload);
    assert.equal(await frame(), null);
  });
  await step('запись открывается вторым самостоятельным плеером', async () => {
    await click('[data-key="m:102"] .stream[data-play]');
    await until('два окна', () => players().length === 2 && players().some(w => /id=2&/.test(w.webContents.getURL())));
    for (const w of players()) if (/id=2&/.test(w.webContents.getURL())) w.close();
    await until('осталось окно эфира', () => players().length === 1);
    assert.equal(await frame(), null);
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
    assert.deepEqual(labels, ['ATP · одиночный разряд', 'WTA · одиночный разряд', 'ATP · парный разряд', 'WTA · парный разряд']);
    assert.deepEqual(await page(`[...document.querySelectorAll('#settings input[name="league"]')].map((i) => i.checked)`), [true, true, false, false], 'пары по умолчанию выключены');
    assert.equal(await page(`document.querySelectorAll('#settings #chan-list li').length`), 5);
    await page(`document.querySelector('#settings').close(), true`);
  });

  await step('клик по уведомлению: скрытое окно показывается и открывает идущий матч в плеере', async () => {
    win.hide();
    await sleep(300);
    const { localYmd } = await import('../../src/core/day.mjs');
    win.showInactive(); // как openMatch в main.cjs: показать окно и попросить страницу раскрыть матч
    win.webContents.send('open-match', { date: localYmd(new Date()), id: 101 });
    await until('окно из уведомления', () => players().length === 2);
    assert.equal(win.isVisible(), true);
  });

  await step('крестик прячет окно в трей: приложение работает, плеер и лента закрыты, лента открывается при показе', async () => {
    for (const w of players()) w.destroy();
    assert.equal(await frame(), null);
    win.close();
    await sleep(500);
    assert.equal(win.isDestroyed(), false);
    assert.equal(win.isVisible(), false);
    assert.equal(await page(`!!document.querySelector('.player iframe')`), false, 'плеер закрыт');
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
