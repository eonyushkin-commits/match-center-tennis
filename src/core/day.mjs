// Расписание дня: турниры выбранных разрядов в заданном порядке, счёт по сетам, привязанные эфиры.
// Имена на странице — как в ESPN. Русские написания (players.json) нужны только чтобы узнавать
// игроков в заголовках эфиров VK.
import { readFile } from 'node:fs/promises';
import { createNamer, matchStreams } from './match.mjs';
import { expect, isObject } from './shape.mjs';

const PLAYERS = JSON.parse(await readFile(new URL('./players.json', import.meta.url), 'utf8')); // id ESPN → [имя, фамилия]
// Справочник уровней турниров по сезонам (tournaments.json, правится вручную раз в год):
// сезон → тур → номер турнира ESPN → уровень. ESPN сам уровень не отдаёт, только признак Шлема.
const SEASONS = new Map(Object.entries(JSON.parse(await readFile(new URL('./tournaments.json', import.meta.url), 'utf8')))
  .map(([year, s]) => [year, { atp: new Map(s.atp.map((t) => [t.id, t.level])), wta: new Map(s.wta.map((t) => [t.id, t.level])) }]));

// Уровень турнира для разряда тура. Есть справочник сезона — показываем только турниры из него
// (Шлемы, итоговые, 1000/500/250), остальные (125, Next Gen, командные) — undefined, их прячем.
// Справочника нет — показываем всё, что отдал ESPN, с меткой только у Шлема.
export function levelOf(ev, tour, seasons = SEASONS) {
  const [num, year] = String(ev.id).split('-');
  const season = seasons.get(year);
  if (season) return season[tour].get(num);
  return ev.major === true ? 'Grand Slam' : null;
}

// Разряды — «турниры» настроек: номер → тур, вид, метка разряда в ESPN и подпись
// (подписи те же, что в knownLeagues из defaults.json)
export const CATEGORIES = {
  1: { tour: 'atp', doubles: false, slug: 'mens-singles', label: 'Мужчины · одиночный разряд' },
  2: { tour: 'wta', doubles: false, slug: 'womens-singles', label: 'Женщины · одиночный разряд' },
  3: { tour: 'atp', doubles: true, slug: 'mens-doubles', label: 'Мужчины · парный разряд' },
  4: { tour: 'wta', doubles: true, slug: 'womens-doubles', label: 'Женщины · парный разряд' },
};
// туры, которые нужны для выбранных разрядов
export const toursOf = (leagues) => [...new Set(leagues.map((id) => CATEGORIES[id]?.tour).filter(Boolean))];

const ROUNDS = {
  final: 'Финал', semifinal: 'Полуфинал', semifinals: 'Полуфинал', quarterfinal: 'Четвертьфинал', quarterfinals: 'Четвертьфинал',
  'group stage': 'Групповой этап', 'round robin': 'Групповой этап', 'round of 16': '1/8 финала', 'round of 32': '1/16 финала',
  'round of 64': '1/32 финала', 'round of 128': '1/64 финала', 'qualifying final': 'Финал квалификации',
};
function roundName(text) {
  const s = String(text ?? '').trim();
  const known = ROUNDS[s.toLowerCase()];
  if (known) return known;
  let m = /^Round (\d)$/i.exec(s);
  if (m) return `${m[1]}-й круг`;
  m = /^Qualifying (?:Round )?(\d)/i.exec(s);
  if (m) return `Квалификация, ${m[1]}-й круг`;
  return s;
}

const fmts = new Map();
// день (ГГГГММДД), на который момент t приходится в часовом поясе tz
export function ymdIn(t, tz) {
  let f = fmts.get(tz);
  if (!f) fmts.set(tz, (f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })));
  return f.format(t).replaceAll('-', '');
}

function player(a) {
  const id = Number(a.id);
  const enName = String(a.displayName || a.fullName || '').replace(/\s+/g, ' ').trim();
  if (!enName || /^TBD$/i.test(enName)) return null; // соперник ещё не определён
  const enLast = String(a.shortName || '').replace(/^\S*\.\s*/, '').trim() || enName.split(' ').slice(1).join(' ') || enName;
  const ru = PLAYERS[a.id];
  return {
    id: Number.isInteger(id) && id > 0 ? id : null, name: enName, last: enLast, flag: a.flag?.href || null,
    ru: ru ? { name: `${ru[0]} ${ru[1]}`.trim(), last: ru[1] } : null,
  };
}

const athleteId = (a) => /\/id\/(\d+)\//.exec(a.links?.[0]?.href || '')?.[1];

// сторона матча: игрок или пара
function side(p, other, live) {
  const athletes = p.athlete
    ? [{ ...p.athlete, id: p.id }]
    : (p.roster?.athletes || []).map((a, i) => ({ ...a, id: athleteId(a) ?? String(p.id ?? '').split('-')[i] }));
  const players = athletes.map(player).filter(Boolean);
  const mine = p.linescores || [], theirs = other.linescores || [];
  // идущий сет ещё никем не выигран
  const done = live ? mine.length - 1 : mine.length;
  const wonSet = (i) => i < done && mine[i]?.value > (theirs[i]?.value ?? -1);
  return {
    id: players.length === 1 ? players[0].id : null, // ★ — только у игрока одиночного разряда
    ids: players.map((x) => x.id).filter(Boolean),
    name: players.length > 1 ? players.map((x) => x.last).join(' / ') : players[0]?.name || 'Не определён',
    players,
    seed: p.curatedRank?.current ?? null,
    // won — сет выигран этим игроком: на странице его счёт в сете выделяется
    sets: mine.map((l, i) => ({ games: l.value ?? null, tiebreak: l.tiebreak ?? null, won: wonSet(i) })),
    score: mine.length ? mine.filter((_, i) => wonSet(i)).length : null,
    winner: p.winner === true,
    serving: live && p.possession === true,
  };
}

const okMatch = (c) => isObject(c) && c.id != null && typeof c.date === 'string' && typeof c.status?.type?.state === 'string' && Array.isArray(c.competitors);

function status(c) {
  const { state, name = '' } = c.status.type;
  const cancelled = /CANCEL|POSTPON|ABANDON/.test(name);
  const finished = state === 'post' && !cancelled;
  let liveTime = null, reason = null;
  if (state === 'in') liveTime = /SUSPEND|DELAY/.test(name) ? 'Пауза' : c.status.period ? `${c.status.period}-й сет` : 'Идёт';
  if (cancelled) reason = /POSTPON/.test(name) ? 'Перенос' : 'Отмена';
  else if (finished) reason = /RETIRE/.test(name) ? 'Отказ' : /WALKOVER/.test(name) ? 'Неявка' : 'Оконч.';
  return { started: state === 'in' || finished, finished, cancelled, liveTime, reason };
}

// data — ответ espn.day: { events, stale }; date — день (ГГГГММДД) в часовом поясе tz
export function buildDay({ data, date, tz, settings, snapshot, now = Date.now() }) {
  const favorites = new Set(settings.favorites.map((f) => f.id));
  const favoriteMatches = new Set(settings.favoriteMatches.map((f) => f.id));
  const namesOf = createNamer(settings.teamAliases);
  const names = (s) => s.players.map((p) => namesOf({ name: p.ru?.name, last: p.ru?.last, enName: p.name, enLast: p.last }));
  const today = ymdIn(now, tz);
  const seen = new Set(); // один матч не должен повторяться в списке

  const leagues = [];
  for (const cat of settings.leagues) {
    const kind = CATEGORIES[cat];
    if (!kind) continue;
    // На Шлемах оба табло ESPN содержат обе сетки; выбираем готовую метку разряда.
    const wanted = kind.slug;
    for (const ev of data.events || []) {
      if (ev.tour !== kind.tour) continue;
      expect(ev.id != null && typeof ev.name === 'string' && (ev.groupings == null || Array.isArray(ev.groupings)),
        'ESPN', `у турнира ${ev?.id ?? '?'} нет названия или списка разрядов`);
      const level = levelOf(ev, kind.tour);
      if (level === undefined) continue;
      const matches = [];
      for (const g of ev.groupings || []) {
        const slug = g?.grouping?.slug;
        expect(typeof slug === 'string' && Array.isArray(g.competitions), 'ESPN', `у турнира ${ev.id} разряд без названия или матчей`);
        if (slug !== wanted) continue;
        for (const c of g.competitions) {
          expect(okMatch(c), 'ESPN', `у матча ${c?.id ?? '?'} нет времени, статуса или участников`);
          if (c.competitors.length !== 2 || seen.has(c.id)) continue;
          const at = Date.parse(c.date);
          const st = status(c);
          const live = st.started && !st.finished;
          // идущий матч, начатый до полуночи, остаётся и в сегодняшнем дне
          if (ymdIn(at, tz) !== date && !(live && date === today)) continue;
          const [h, a] = [...c.competitors].sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
          const home = side(h, a, live), away = side(a, h, live);
          if (!home.players.length && !away.players.length) continue; // оба участника ещё не определены
          seen.add(c.id);
          const m = {
            id: Number(c.id),
            utcTime: new Date(at).toISOString(),
            // у матча «после предыдущего» время в ESPN условное
            timeKnown: c.timeValid !== false && !/TBD/i.test(c.status.type.detail || ''),
            doubles: kind.doubles,
            round: roundName(c.round?.displayName),
            court: c.venue?.court || null,
            home, away, ...st,
          };
          m.remind = favoriteMatches.has(m.id);
          m.favorite = m.remind || [...home.ids, ...away.ids].some((id) => favorites.has(id));
          m.streams = matchStreams(m, names(home), names(away), snapshot.streams);
          matches.push(m);
        }
      }
      if (!matches.length) continue;
      matches.sort((x, y) => x.timeKnown - y.timeKnown ? y.timeKnown - x.timeKnown : Date.parse(x.utcTime) - Date.parse(y.utcTime));
      leagues.push({
        id: `${cat}:${ev.id}`,
        name: ev.name,
        level, // «WTA 500», «Grand Slam»; null — уровень неизвестен
        country: kind.label,
        matches,
      });
    }
  }

  // stale — { message, format }: показано полученное ранее
  return { leagues, stale: data.stale || null };
}
