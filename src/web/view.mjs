// Разметка: данные → HTML-строка. Без DOM и без общего состояния — всё нужное приходит аргументами.
import { STATUS, audience, esc, hhmm, isLive } from './format.mjs';

// Шапка раздела: «Сейчас в эфире» или турнир с разрядом
export function sectionHeadHtml(s) {
  return s.live
    ? `Сейчас в эфире<span class="count">${s.rows.length}</span>`
    : `${esc(s.lg.name)} <small>${esc(s.lg.country)}</small><span class="count">${s.rows.length}</span>`;
}

// у канала бывает несколько эфиров на матч (перезапуск) — нумеруем: «Sportcast», «Sportcast 2»
function streamLabels(streams) {
  const seen = {};
  return streams.map((s) => ((seen[s.channel] = (seen[s.channel] || 0) + 1) > 1 ? `${s.channel} ${seen[s.channel]}` : s.channel));
}

// счёт по сетам: геймы и, если был тай-брейк, очки в нём мелко сверху; выигранный сет выделен
const setsHtml = (t) => `<span class="sets">${t.sets.map((s) =>
  `<span class="set${s.won ? ' won' : ''}">${esc(s.games)}${s.tiebreak != null ? `<sup>${esc(s.tiebreak)}</sup>` : ''}</span>`).join('')}</span>`;

// Строка матча. view: { favIds — Set игроков в избранном, hidden(m) — прятать ли счёт,
// player — { rowKey, url } открытого плеера }
export function rowHtml({ key, m, lg, showLeague }, view) {
  const live = isLive(m);
  const when = esc(m.cancelled ? (m.reason || 'Отмена') : live ? (m.liveTime || 'LIVE') : m.finished ? (m.reason || 'Оконч.') : m.timeKnown ? hhmm(m.utcTime) : '—');
  const showScore = m.started || m.finished;
  const hidden = view.hidden(m);
  // номер посева — перед именем; место под него есть у обоих игроков, чтобы имена стояли ровно
  const seeded = !!(m.home.seed || m.away.seed);
  const team = (t) => {
    const fav = t.id != null && view.favIds.has(t.id);
    const score = hidden
      ? `<button type="button" class="score masked" data-reveal="${m.id}" title="Показать счёт">?</button>`
      : setsHtml(t);
    const flags = t.players.filter((p) => p.flag).map((p) => `<img loading="lazy" src="${esc(p.flag)}" alt="">`).join('');
    // ★ — у игрока одиночного разряда: пара в избранном, если в нём хотя бы один из двоих
    const star = t.id != null ? `<button type="button" class="star${fav ? ' on' : ''}" data-fav="${t.id}" data-name="${esc(t.name)}" aria-pressed="${fav}"
        title="${fav ? 'Убрать из избранного' : 'В избранное — напомню за 15 минут и в начале каждого матча игрока'}">★</button>` : '';
    return `<div class="team${!hidden && m.finished && t.winner ? ' win' : ''}">
      <span class="flags">${flags}</span>
      ${seeded ? `<small class="seed"${t.seed ? ' title="Номер посева"' : ''}>${esc(t.seed)}</small>` : ''}<span class="name">${esc(t.name)}</span>${!hidden && t.serving ? '<span class="serve" title="Подаёт"></span>' : ''}
      ${star}
      ${showScore ? score : ''}</div>`;
  };

  const labels = streamLabels(m.streams);
  const p = view.player;
  let chips = m.streams.map((s, i) => {
    const aud = audience(s);
    return `<a class="stream ${s.status}${p?.rowKey === key && p.url === s.url ? ' active' : ''}"
      href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(aud ? `${s.title}\n${aud.title}` : s.title)}" data-play>
      <span class="tag">${STATUS[s.status] || ''}</span>${esc(labels[i])}${aud ? `<span class="aud">${esc(aud.text)}</span>` : ''}</a>`;
  }).join('');
  if (!chips && !m.finished && !m.cancelled) {
    const q = encodeURIComponent(`${m.home.name} ${m.away.name}`);
    chips = `<a class="stream find" href="https://vkvideo.ru/search?q=${q}" target="_blank" rel="noopener">Искать в VK</a>`;
  }
  const bell = !m.started && !m.cancelled && m.timeKnown
    ? `<button type="button" class="bell${m.remind ? ' on' : ''}" data-remind aria-pressed="${!!m.remind}"
        title="${m.remind ? 'Не напоминать' : 'Напомнить за 15 минут и в начале матча'}">🔔</button>` : '';
  const meta = [m.round, m.court].filter(Boolean).map(esc).join(' · ');
  // турнир, а под ним раунд и корт — отдельными строками над игроками: справа от счёта они
  // сдвигали бы счёт у каждого матча по-своему
  return `${showLeague ? `<div class="lg-tag">${esc(lg.name)} · ${esc(lg.country)}</div>` : ''}${meta ? `<div class="lg-tag meta">${meta}</div>` : ''}<div class="when${live ? ' live' : ''}">${when}${bell}</div>
    <div class="teams">${team(m.home)}${team(m.away)}</div>
    <div class="side"></div>
    ${chips ? `<div class="streams">${chips}</div>` : ''}`;
}

export function emptyHtml(filtered) {
  if (filtered) return '<b>Нет матчей по выбранным фильтрам</b><button type="button" class="btn" data-action="reset-filters">Сбросить фильтры</button>';
  return '<b>В этот день матчей нет</b>Мужские и женские разряды выбираются в настройках.';
}

// ---------- обновление приложения: «Скачать» → «Установить» ----------
// Крестик прячет полосу до следующего шага (загрузилось, ошибка) или до перезапуска приложения
export const updateKey = (u) => `${u.version}:${u.state}`;
const HIDE = {
  available: 'Скрыть — напомню при следующем запуске',
  downloading: 'Скрыть — загрузка продолжится',
  ready: 'Скрыть — обновление установится при выходе из приложения',
  error: 'Скрыть',
};

export function updateHtml(u) {
  if (!HIDE[u.state]) return null;
  const v = esc(u.version);
  const notes = u.notes ? ` <a href="${esc(u.notes)}" target="_blank" rel="noopener">Что нового ↗</a>` : '';
  const hide = `<button type="button" class="icon-btn" data-action="update-dismiss" aria-label="Скрыть" title="${HIDE[u.state]}">✕</button>`;
  if (u.state === 'available') return `<span><b>Доступна версия ${v}.</b>${notes}</span>
    <span class="actions"><button type="button" class="btn primary" data-action="update-download">Скачать</button>${hide}</span>`;
  if (u.state === 'downloading') return `<span><b>Загружается версия ${v}…</b> ${u.percent || 0}%</span><progress max="100" value="${u.percent || 0}"></progress>
    <span class="actions">${hide}</span>`;
  if (u.state === 'ready') return `<span><b>Версия ${v} загружена.</b> Приложение перезапустится — открытая трансляция прервётся.${notes}</span>
    <span class="actions"><button type="button" class="btn primary" data-action="update-install">Установить</button>${hide}</span>`;
  return `<span><b>Не удалось загрузить обновление:</b> ${esc(u.error)}</span>
    <span class="actions"><button type="button" class="btn" data-action="update-download">Повторить</button>${hide}</span>`;
}

// Полосы над списком: обновление, ошибки, недоступные источники → [[класс, html], …]
export function notices({ error, day, status, saveError, update: u, updateDismissed }) {
  const out = [];
  if (error && day) out.push(['bad', `<b>Не удалось обновить расписание:</b> ${esc(error)}. Показаны последние данные.`]);
  if (day?.stale?.format) out.push(['bad', `<b>${esc(day.stale.message)}.</b> Показано расписание, полученное ранее.`]);
  else if (day?.stale) out.push(['', '<b>ESPN сейчас недоступен</b> — показано расписание, полученное ранее.']);
  for (const w of status?.warnings || []) out.push(['bad', esc(w)]);
  const vk = status?.vk;
  if (vk?.ready && vk.channels.length && vk.channels.every((c) => c.ok === false))
    out.push(['bad', '<b>Не удалось прочитать ни один канал VK.</b> Каналы читаются только с российского адреса. <button type="button" data-action="status">Подробнее</button>']);
  if (saveError) out.push(['bad', `<b>Не удалось сохранить настройки:</b> ${esc(saveError)}`]);
  const update = u && updateDismissed !== updateKey(u) && updateHtml(u);
  if (update) out.unshift(['update', update]);
  return out;
}

// ---------- панель каналов ----------
export function statusBadge(vk) {
  if (!vk?.ready) return { cls: 'wait', text: 'VK…' };
  const bad = vk.channels.filter((c) => c.ok === false).length;
  const cls = !vk.channels.length ? '' : !bad ? 'ok' : bad === vk.channels.length ? 'bad' : 'warn';
  return { cls, text: `${vk.streamCount} эфиров · ${hhmm(vk.updatedAt)}` };
}

export function popoverHtml(vk, refreshSeconds) {
  const rows = (vk?.channels || []).map((c) => {
    const cls = c.ok === null ? 'wait' : c.ok ? 'ok' : 'bad';
    const how = c.ok === null ? 'читается…' : c.ok ? (c.via === 'api' ? 'через API' : 'через страницу канала') : esc(c.error);
    const when = c.okAt ? ` · данные от ${hhmm(c.okAt)}` : '';
    return `<div class="chan"><span class="dot ${cls}"></span><b>${esc(c.label)}</b><span class="n">${c.count} эфиров</span><small>${how}${c.ok === null ? '' : when}</small></div>`;
  }).join('');
  return `<h4>Каналы VK</h4>${rows || '<div class="empty">Каналов нет — добавьте их в настройках</div>'}
    <div class="actions"><span>Обновляются раз в ${refreshSeconds ?? 60} с</span></div>`;
}
