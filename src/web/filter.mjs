// Что показывать в списке: фильтры, поиск, избранное, скрытый счёт. Без DOM.
import { isLive } from './format.mjs';

// режим без спойлеров: счёт скрыт, пока его не попросят показать
export const scoresHidden = (m, { hideScores, revealed }) => !!hideScores && !revealed.has(m.id) && (m.started || m.finished);

// ★ и 🔔 прямо в данных дня — чтобы не ждать ответа сервера после клика
export function markFavorites(day, settings) {
  const players = new Set(settings.favorites.map((f) => f.id));
  const matches = new Set(settings.favoriteMatches.map((f) => f.id));
  for (const lg of day?.leagues || [])
    for (const m of lg.matches) {
      m.remind = matches.has(m.id);
      m.favorite = m.remind || [...m.home.ids, ...m.away.ids].some((id) => players.has(id));
    }
}

// Разделы списка: «Сейчас в эфире» (только сегодня) и турниры.
// Поиск — по турниру и по игрокам: фамилия в паре, полное имя, русское написание из словаря.
// byTime — матчи идут по времени начала, а не турнир за турниром в порядке из настроек.
export function sections({ day, isToday, filters: f, q, byTime }) {
  q = q.trim().toLowerCase();
  const who = (m) => [m.home, m.away].flatMap((t) => [t.name, ...t.players.flatMap((p) => [p.name, p.ru?.name])]).filter(Boolean).join(' ').toLowerCase();
  const hit = (m, lg) => (!f.streams || m.streams.length) && (!f.live || isLive(m)) && (!f.favorites || m.favorite)
    && (!q || `${lg.name} ${lg.level || ''} ${lg.country}`.toLowerCase().includes(q) || who(m).includes(q));
  const out = [];

  // Блок эфиров показывается сегодня, если не включён фильтр «Идут сейчас».
  const liveBlock = isToday && !f.live;
  const live = [];
  for (const lg of day.leagues) for (const m of lg.matches) {
    const key = `live:${m.id}`;
    if (liveBlock && isLive(m) && m.streams.some((s) => s.status === 'started') && hit(m, lg)) live.push({ key, m, lg, showLeague: true });
  }
  if (live.length) out.push({ key: 'live', live: true, rows: live });
  const leagues = [];
  for (const lg of day.leagues) {
    const rows = lg.matches.filter((m) => hit(m, lg)).map((m) => ({ key: `m:${m.id}`, m, lg }));
    if (rows.length) leagues.push({ key: `lg:${lg.id}`, lg, rows });
  }
  if (!byTime) return [...out, ...leagues];

  // Матчи идут по времени начала; начинающиеся одновременно стоят блоком своего турнира,
  // блоки одного времени — в порядке из настроек. Соседние блоки одного турнира — один раздел.
  // Матчи без назначенного времени (ESPN даёт им условную дату) — в конце, как и внутри турнира.
  const slots = leagues.flatMap((s, order) => s.rows.map((r) => ({ r, lg: s.lg, order, at: Date.parse(r.m.utcTime), tbd: !r.m.timeKnown })));
  slots.sort((a, b) => a.tbd - b.tbd || a.at - b.at || a.order - b.order);
  for (const { r, lg } of slots) {
    const last = out.at(-1);
    if (last?.lg === lg) last.rows.push(r);
    else out.push({ key: `lg:${lg.id}:${r.m.id}`, lg, rows: [r] }); // турнир может встретиться в списке не раз
  }
  return out;
}
