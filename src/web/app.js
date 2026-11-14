// Главная страница: состояние, лента с сервера, плеер и обработчики. Разметка — в view.mjs,
// что показывать — в filter.mjs, форматирование — в format.mjs:
// они без DOM и покрыты тестами.
import { reconcile, setHtml } from './dom.mjs';
import { markFavorites as mark, scoresHidden, sections as buildSections } from './filter.mjs';
import { addDays, dateStrip, embedUrl, esc, inDateRange, matchTitle, parseYmd, ymd } from './format.mjs';
import { openSettingsDialog } from './settings-ui.mjs';
import { emptyHtml, notices, popoverHtml, rowHtml, sectionHeadHtml, statusBadge, updateKey } from './view.mjs';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

const state = {
  settings: null, // настройки с сервера: тема, фильтры, избранное живут там, а не в браузере
  status: null,
  day: null,
  error: null,
  saveError: null,
  today: ymd(new Date()),
  date: ymd(new Date()),
  stripStart: null, // первый день полосы дат; null — сегодня в середине
  q: '',
  revealed: new Set(), // матчи, у которых в режиме без спойлеров уже показали счёт
  update: null, // обновление приложения (только в приложении): { state, version, percent, notes, error }
  updateDismissed: null, // «версия:шаг» скрытой крестиком полосы обновления — до следующего шага или перезапуска
};
const matchIdOf = (rowKey) => Number(rowKey.split(':')[1]);

// режим без спойлеров: счёт скрыт, пока его не попросят показать
const isHidden = (m) => scoresHidden(m, { hideScores: state.settings?.ui.hideScores, revealed: state.revealed });

// ---------- сеть ----------
async function request(method, url, { body } = {}) {
  const r = await fetch(url, {
    method, cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `${r.status} ${r.statusText}`);
  return j;
}

// ---------- лента ----------
// Страница не опрашивает сервер. Она подписана на выбранный день, а приложение само присылает
// расписание и состояние каналов — сразу и при каждом изменении.
// Сменился день — подписка открывается заново; скрытое окно не подписано.
let feed = null; // EventSource текущей подписки
let arrival = null; // { promise, resolve }: выполнится, когда придёт расписание (или ошибка) текущей подписки
function subscribe() {
  feed?.close();
  const q = new URLSearchParams({ date: state.date, tz });
  const es = (feed = new EventSource(`/api/events?${q}`));
  $('#refresh').classList.add('spin');

  const mine = Promise.withResolvers();
  arrival?.resolve(mine.promise); // кто ждал прежнюю подписку, дождётся этой
  arrival = mine;
  const got = (error) => {
    state.error = error;
    $('#refresh').classList.remove('spin');
    mine.resolve();
    render();
  };
  const data = (handler) => (e) => handler(JSON.parse(e.data));

  es.addEventListener('status', data((status) => {
    state.status = status;
    $('#refresh').classList.remove('spin'); // каналы перечитаны (см. refreshNow)
    renderStatus();
    renderNotices();
  }));
  es.addEventListener('day', data((day) => {
    state.day = day;
    got(null);
  }));
  es.addEventListener('day-error', data(({ message }) => got(message)));
  // оборвалась — EventSource переподключается сам; отказал совсем — пробуем заново
  es.onerror = () => {
    if (es.readyState !== EventSource.CLOSED) return;
    got('Нет связи с приложением');
    setTimeout(() => { if (feed === es) subscribe(); }, 3000);
  };
  return mine.promise;
}

// «Обновить» по кнопке или клавише R: приложение сразу перечитывает каналы VK и расписание,
// а новое присылает лентой. Лента оборвалась — заодно открываем её заново.
function refreshNow() {
  $('#refresh').classList.add('spin');
  if (!feed || feed.readyState === EventSource.CLOSED) subscribe();
  request('POST', '/api/refresh').catch((e) => {
    $('#refresh').classList.remove('spin');
    state.error = e.message;
    render();
  });
}

function unsubscribe() {
  feed?.close();
  feed = null;
}

// ---------- настройки ----------
let uiTimer = null;
let uiPending = {};
function saveUi(patch) {
  Object.assign(uiPending, patch);
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => {
    const ui = uiPending;
    uiPending = {};
    saveNow({ ui });
  }, 400);
}

function applyTheme() {
  const theme = state.settings?.ui.theme || 'system';
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  $('#theme').title = `Тема: ${{ system: 'как в системе', light: 'светлая', dark: 'тёмная' }[theme]}`;
}

const favoriteIds = () => new Set((state.settings?.favorites || []).map((f) => f.id));

function toggleFavorite(id, name) {
  const favs = state.settings.favorites;
  state.settings.favorites = favs.some((f) => f.id === id) ? favs.filter((f) => f.id !== id) : [...favs, { id, name }];
  markFavorites();
  render();
  saveNow({ favorites: state.settings.favorites });
}

// 🔔 у матча: напомнить за 15 минут и в начале, даже если игроки не в избранном
function toggleRemind(m) {
  const list = state.settings.favoriteMatches;
  state.settings.favoriteMatches = list.some((f) => f.id === m.id)
    ? list.filter((f) => f.id !== m.id)
    : [...list, { id: m.id, name: matchTitle(m), utcTime: m.utcTime }];
  markFavorites();
  render();
  saveNow({ favoriteMatches: state.settings.favoriteMatches });
}

const markFavorites = () => mark(state.day, state.settings);

function saveNow(patch) {
  request('PUT', '/api/settings', { body: patch }).then(() => { state.saveError = null; }, (e) => {
    state.saveError = e.message;
    renderNotices();
  });
}

// ---------- что показывать ----------
const sections = () => buildSections({
  day: state.day,
  isToday: state.date === state.today,
  filters: state.settings.ui.filters,
  q: state.q,
  byTime: state.settings.ui.leaguesByTime,
});

// ---------- отрисовка ----------
function render() {
  renderStatus();
  renderNotices();
  renderFilters();
  renderList();
}

// Полоса дат: ‹ › — на день назад и вперёд, в пределах сегодня ±10 дней
function renderDates() {
  const { start, days } = dateStrip(state.today, state.date, state.stripStart);
  state.stripStart = start;
  const arrow = (d, sign, label) => `<button type="button" class="shift" data-date="${d}" title="${label}" aria-label="${label}"${inDateRange(state.today, d) ? '' : ' disabled'}>${sign}</button>`;
  const html = [arrow(addDays(state.date, -1), '‹', 'Предыдущий день (←)')];
  for (const { date: d, offset: i } of days) {
    const dt = parseYmd(d);
    const label = i === 0 ? 'Сегодня' : i === -1 ? 'Вчера' : i === 1 ? 'Завтра' : dt.toLocaleDateString('ru-RU', { weekday: 'short' });
    const on = d === state.date;
    html.push(`<button type="button" data-date="${d}" class="${on ? 'on' : ''}" aria-pressed="${on}">${label}<small>${dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</small></button>`);
  }
  html.push(arrow(addDays(state.date, 1), '›', 'Следующий день (→)'));
  $('#dates').innerHTML = html.join('');
  $('#dates .on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderFilters() {
  const f = state.settings?.ui.filters || {};
  for (const b of $$('[data-filter]')) {
    b.classList.toggle('on', !!f[b.dataset.filter]);
    b.setAttribute('aria-pressed', String(!!f[b.dataset.filter]));
  }
  const hide = !!state.settings?.ui.hideScores;
  $('#spoilers').classList.toggle('on', hide);
  $('#spoilers').setAttribute('aria-pressed', String(hide));
  const byTime = !!state.settings?.ui.leaguesByTime;
  $('#by-time').classList.toggle('on', byTime);
  $('#by-time').setAttribute('aria-pressed', String(byTime));
  $('#by-time').title = `Порядок матчей: ${byTime ? 'по времени начала' : 'по турнирам'}`;
}

function renderStatus() {
  const vk = state.status?.vk;
  const { cls, text } = statusBadge(vk);
  $('#status .dot').className = `dot ${cls}`;
  $('#status-text').textContent = text;
  $('#status').title = vk?.ready ? 'Каналы VK: нажмите, чтобы увидеть подробности' : 'Каналы VK читаются…';
  if (!$('#status-pop').hidden) renderPopover();
  if (state.status?.version) $('#foot').innerHTML = `Матч-центр ${esc(state.status.version)} · <kbd>←</kbd> <kbd>→</kbd> дни · <kbd>/</kbd> поиск · <kbd>R</kbd> обновить`;
}

function renderNotices() {
  $('#notices').innerHTML = notices(state).map(([cls, html]) => `<div class="notice ${cls}">${html}</div>`).join('');
}

function renderList() {
  const list = $('#list');
  if (!state.settings || !state.day) {
    if (state.error) reconcile(list, [{ key: 'error', cls: 'empty', html: `<b>Не удалось загрузить расписание</b>${esc(state.error)}` }]);
    else reconcile(list, [1, 2, 3].map((i) => ({ key: `skeleton${i}`, cls: 'skeleton' })));
    return;
  }
  list.setAttribute('aria-busy', 'false');
  const secs = sections();
  if (!secs.length) {
    const f = state.settings.ui.filters;
    reconcile(list, [{ key: 'empty', cls: 'empty', html: emptyHtml(!!(state.q || f.streams || f.live || f.favorites)) }]);
    return;
  }
  reconcile(list, secs.map((s) => ({
    key: s.key,
    cls: s.live ? 'league live' : 'league',
    create: () => {
      const n = document.createElement('section');
      n.innerHTML = '<div class="lhead"></div><div class="rows"></div>';
      return n;
    },
  })));
  const view = { favIds: favoriteIds(), hidden: isHidden };
  const nodes = new Map([...list.children].map((n) => [n.dataset.key, n]));
  for (const s of secs) {
    const node = nodes.get(s.key);
    setHtml(node.firstElementChild, sectionHeadHtml(s));
    const items = [];
    for (const r of s.rows) {
      items.push({ key: r.key, cls: `match${r.m.favorite ? ' fav' : ''}`, html: rowHtml(r, view) });
    }
    reconcile(node.lastElementChild, items);
  }
}

// ---------- панель каналов ----------
function renderPopover() {
  $('#status-pop').innerHTML = popoverHtml(state.status?.vk, state.settings?.refreshSeconds);
}

function togglePopover(show = $('#status-pop').hidden) {
  const pop = $('#status-pop');
  $('#status').setAttribute('aria-expanded', String(show));
  if (!show) { pop.hidden = true; return; }
  renderPopover();
  pop.hidden = false;
  const r = $('#status').getBoundingClientRect();
  pop.style.top = `${r.bottom + 8}px`;
  pop.style.left = `${Math.max(12, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 12))}px`;
}

// ---------- плеер ----------
function findMatch(id) {
  for (const lg of state.day?.leagues || []) for (const m of lg.matches) if (m.id === id) return m;
  return null;
}
const matchOf = (rowKey) => (rowKey ? findMatch(matchIdOf(rowKey)) : null);
// эфир матча по его ссылке, если его можно встроить: { m, s, embed } или null
function streamOf(rowKey, url) {
  const m = matchOf(rowKey);
  const s = m?.streams.find((x) => x.url === url);
  const embed = s && embedUrl(s);
  return embed ? { m, s, embed } : null;
}

// Electron открывает официальный плеер VK в отдельном защищённом окне.
function openPlayer(rowKey, url) {
  const found = streamOf(rowKey, url);
  if (!found) return;
  const { m, s, embed } = found;
  const source = new URL(embed);
  source.searchParams.set('autoplay', '1');
  window.mc.openPlayer({ src: source.href, title: `${matchTitle(m)} · ${s.channel}` });
}

// Клик по уведомлению: день матча, строка матча и плеер, если трансляция уже идёт
async function openMatchFromNotification(date, id) {
  await setDate(date);
  const m = findMatch(id);
  if (!m) return;
  const rowKey = document.querySelector(`[data-key="live:${id}"]`) ? `live:${id}` : `m:${id}`;
  const live = m.streams.find((s) => s.status === 'started');
  if (live) openPlayer(rowKey, live.url);
  const row = document.querySelector(`[data-key="${rowKey}"]`);
  row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row?.classList.add('flash');
  setTimeout(() => row?.classList.remove('flash'), 1700);
}
window.mc?.onOpenMatch(({ date, id }) => openMatchFromNotification(date, id));

// ---------- настройки ----------
function openSettings() {
  if (!state.settings) return;
  togglePopover(false);
  openSettingsDialog($('#settings'), {
    settings: state.settings,
    save: async (patch) => {
      state.settings = await request('PUT', '/api/settings', { body: patch });
      render(); // расписание с новыми настройками пришлёт лента
    },
  });
}

// ---------- действия ----------
function setDate(d) {
  if (d === state.date) return feed ? arrival.promise : subscribe();
  state.date = d;
  state.day = null;
  state.error = null;
  renderDates();
  scrollTo({ top: 0 });
  return subscribe();
}

function setFilter(name, value) {
  state.settings.ui.filters[name] = value;
  saveUi({ filters: state.settings.ui.filters });
  render();
}

$('#dates').addEventListener('click', (e) => {
  const b = e.target.closest('[data-date]');
  if (b) setDate(b.dataset.date);
});
for (const b of $$('[data-filter]')) b.addEventListener('click', () => {
  if (state.settings) setFilter(b.dataset.filter, !state.settings.ui.filters[b.dataset.filter]);
});
$('#spoilers').addEventListener('click', () => {
  if (!state.settings) return;
  state.settings.ui.hideScores = !state.settings.ui.hideScores;
  state.revealed.clear(); // включили заново — прячем и то, что раскрывали раньше
  saveUi({ hideScores: state.settings.ui.hideScores });
  render();
});
$('#q').addEventListener('input', (e) => { state.q = e.target.value; if (state.settings) renderList(); });
$('#refresh').addEventListener('click', refreshNow);
$('#open-settings').addEventListener('click', openSettings);
$('#status').addEventListener('click', (e) => { e.stopPropagation(); togglePopover(); });
$('#by-time').addEventListener('click', () => {
  if (!state.settings) return;
  state.settings.ui.leaguesByTime = !state.settings.ui.leaguesByTime;
  saveUi({ leaguesByTime: state.settings.ui.leaguesByTime });
  render();
});
$('#theme').addEventListener('click', () => {
  if (!state.settings) return;
  const order = ['system', 'light', 'dark'];
  const theme = order[(order.indexOf(state.settings.ui.theme) + 1) % order.length];
  state.settings.ui.theme = theme;
  applyTheme();
  saveUi({ theme });
});

$('#list').addEventListener('click', (e) => {
  const star = e.target.closest('[data-fav]');
  if (star) { toggleFavorite(Number(star.dataset.fav), star.dataset.name); return; }
  if (e.target.closest('[data-remind]')) {
    const m = matchOf(e.target.closest('[data-key]').dataset.key);
    if (m) toggleRemind(m);
    return;
  }
  const reveal = e.target.closest('[data-reveal]');
  if (reveal) {
    state.revealed.add(Number(reveal.dataset.reveal));
    renderList();
    return;
  }
  const a = e.target.closest('[data-play]');
  // Ctrl/Shift/средняя кнопка — как обычная ссылка, в браузере
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  const rowKey = a.closest('[data-key]').dataset.key;
  const found = streamOf(rowKey, a.getAttribute('href'));
  if (!found) return; // нет адреса плеера — откроется ссылкой в браузере
  const { s } = found;
  e.preventDefault();
  openPlayer(rowKey, s.url);
});

document.addEventListener('click', (e) => {
  const act = e.target.closest('[data-action]')?.dataset.action;
  if (act === 'reset-filters') {
    state.q = '';
    $('#q').value = '';
    for (const f of Object.keys(state.settings.ui.filters)) state.settings.ui.filters[f] = false;
    saveUi({ filters: state.settings.ui.filters });
    render();
  } else if (act === 'status') {
    e.stopPropagation();
    togglePopover(true);
  } else if (act === 'update-download') {
    window.mc?.downloadUpdate();
  } else if (act === 'update-install') {
    e.target.disabled = true;
    window.mc?.installUpdate();
  } else if (act === 'update-dismiss') {
    if (state.update) state.updateDismissed = updateKey(state.update);
    renderNotices();
  }
  if (!$('#status-pop').hidden && !e.target.closest('#status-pop, #status')) togglePopover(false);
});

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, dialog')) {
    if (e.key === 'Escape' && e.target.id === 'q' && state.q) { e.target.value = ''; state.q = ''; renderList(); }
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') {
    if (!$('#status-pop').hidden) togglePopover(false);
  } else if (e.key === '/') {
    e.preventDefault();
    $('#q').focus();
  } else if (e.code === 'KeyR') {
    refreshNow();
  } else if (e.key === ',') {
    openSettings();
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const next = addDays(state.date, e.key === 'ArrowLeft' ? -1 : 1);
    if (inDateRange(state.today, next)) setDate(next); // за краем полосы она сдвинется на день
  }
});

// Смена дня: если смотрели «сегодня», в полночь переходим на новый день сами
function rollover() {
  const today = ymd(new Date());
  if (today === state.today) return;
  const wasToday = state.date === state.today;
  state.today = today;
  if (wasToday) setDate(today);
  else renderDates();
}
setInterval(() => { if (!document.hidden) rollover(); }, 30e3);
// скрытое окно (трей, свёрнуто) на ленту не подписано; при показе подписывается заново
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return unsubscribe();
  rollover();
  if (!feed) subscribe();
});
addEventListener('resize', () => { if (!$('#status-pop').hidden) togglePopover(true); });

// ---------- запуск ----------
async function boot() {
  renderDates();
  render();
  try {
    state.settings = await request('GET', '/api/settings');
  } catch (e) {
    state.error = e.message;
    render();
    setTimeout(boot, 3000);
    return;
  }
  state.error = null;
  applyTheme();
  if (!document.hidden) subscribe();
  // обновления приложения: состояние на момент загрузки страницы и дальнейшие изменения
  const onUpdate = (u) => {
    state.update = u?.state && u.state !== 'none' ? u : null;
    if (u?.manual) state.updateDismissed = null; // проверили из меню — полосу показываем снова
    renderNotices();
  };
  window.mc?.getUpdate().then(onUpdate);
  window.mc?.onUpdate(onUpdate);
}
boot();
