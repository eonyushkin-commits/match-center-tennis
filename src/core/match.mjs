// Сопоставление заголовков VK-эфиров с теннисными матчами.
// э → е: каналы пишут и «Баэс», и «Баес», и «Шувэй», и «Шувей».
export const norm = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/[à-ɏ]/g, (c) => c.normalize('NFD')[0]) // é → e; кириллицу не трогаем: й и ё — тоже «буква со значком»
  .replace(/ё/g, 'е').replace(/э/g, 'е')
  .replace(/[^a-zа-я0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Игроки ищутся в любой части заголовка между «|» или « / »: у каналов бывает и
// «Мирра Андреева - Диана Шнайдер | Комментатор», и «Соболенко – Свитолина / Итоговый турнир WTA».
// Между игроками — тире, дефис, vs, «против» или отдельная буква x (латинская, русская, ×).
// Пара пишется через косую черту без пробелов: «Гуо/Младенович — Мертенс/Чжан Шуай».
// Лишние слова рядом с именами отсекает nameScore.
export function parsePair(title) {
  for (const seg of String(title ?? '').split(/\||\s\/\s/)) {
    const parts = seg.split(/\s+(?:—|–|-|vs\.?|против|x|х|×)\s+/i);
    if (parts.length !== 2) continue;
    const teams = parts.map((p) => norm(p.replace(/\(.*?\)|\d+\s*:\s*\d+/g, '')));
    if (teams.every(Boolean)) return { teams, doubles: /\S\/\S/.test(seg) };
  }
  return null;
}
export const parseTeams = (title) => parsePair(title)?.teams ?? null;

const LATIN = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', ю: 'yu', я: 'ya',
};
// «басаваредди» → «basavareddi»: игрока, которого нет в словаре русских имён, узнаём по латинице
export const latinize = (s) => s.replace(/[а-я]/g, (c) => LATIN[c] ?? c);

function bigrams(s) {
  const out = new Set();
  const t = s.replace(/ /g, '');
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

// Нечёткое сравнение (опечатки, «Дабровски»/«Дабровский»). Ниже 0.72 считаем разными игроками.
function dice(a, b) {
  const A = bigrams(a), B = bigrams(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const d = (2 * inter) / (A.size + B.size || 1);
  return d >= 0.72 ? d : 0;
}

// a — имя игрока (фамилия или полное), b — половина заголовка эфира (может содержать лишние слова)
export function nameScore(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = a.split(' '), tb = b.split(' ');
  // всё имя есть в заголовке — «арина соболенко итоговый турнир wta» ⊃ «соболенко»
  if (ta.every((x) => tb.includes(x))) return 0.9;
  // заголовок — часть имени («меличар» из «меличар мартинес»)
  if (tb.every((x) => ta.includes(x))) return 0.9;
  let score = dice(a, b);
  // сравниваем имя с каждым отрезком заголовка той же длины в словах
  for (let i = 0; i + ta.length <= tb.length; i++)
    score = Math.max(score, 0.85 * dice(a, tb.slice(i, i + ta.length).join(' ')));
  return score;
}

// Все написания игрока: русские фамилия и полное имя из словаря, английские из ESPN, варианты из настроек.
// player — { name, last, enName, enLast }
export function createNamer(aliases = {}) {
  const aliasIndex = new Map(Object.entries(aliases).map(([k, v]) => [norm(k), v.map(norm)]));
  return (player) => {
    const names = [player.last, player.name, player.enLast, player.enName].filter(Boolean).map(norm);
    for (const n of [...names]) names.push(...(aliasIndex.get(n) || []));
    return [...new Set(names)].filter(Boolean);
  };
}

const best = (names, s, lat) => Math.max(0, ...names.map((n) => Math.max(nameScore(n, s), nameScore(n, lat))));
// Сторона матча — один игрок или пара: в половине заголовка должны найтись все
function sideScore(players, s) {
  if (!players.length) return 0;
  const lat = latinize(s);
  return Math.min(...players.map((names) => best(names, s, lat)));
}

const RANK = { started: 0, upcoming: 1, finished: 2, failed: 3 };
const HOUR = 3600e3;
// Внутри статуса: записи — по дате создания видео, идущие и запланированные — по времени начала
// (не по зрителям: иначе кнопки меняются местами при каждом обновлении)
function withinStatus(x, y) {
  if (x.status === 'finished') return (x.created ?? x.time ?? 0) - (y.created ?? y.time ?? 0);
  return (x.time ?? 0) - (y.time ?? 0);
}

// match — { utcTime, finished, doubles }; home, away — написания каждого игрока стороны: [[…], […]]
export function matchStreams(match, home, away, streams) {
  const kickoff = Date.parse(match.utcTime);
  return streams
    // time — когда эфир создан или назначен: каналы заводят его за несколько часов, иногда за день.
    // Окно короче футбольного: на итоговом турнире те же соперники могут встретиться снова через
    // несколько дней. time === null — VK не прислал дату, проверяем только имена.
    .filter((s) => s.teams && (s.time === null || (s.time > kickoff - 48 * HOUR && s.time < kickoff + 12 * HOUR)))
    // эфир пары («Гуо/Младенович — …») к одиночному матчу не относится, даже если фамилии совпали
    .filter((s) => match.doubles || !s.doubles)
    .map((s) => {
      const [a, b] = s.teams;
      const straight = Math.min(sideScore(home, a), sideScore(away, b));
      const swapped = Math.min(sideScore(home, b), sideScore(away, a));
      return { ...s, score: Math.max(straight, swapped) };
    })
    .filter((s) => s.score > 0)
    // Запланированный эфир у завершённого матча — резервный, который так и не запустили: смотреть там нечего.
    .filter((s) => !(match.finished && s.status === 'upcoming'))
    // Порядок: идущие (всегда впереди), затем запланированные, затем записи
    .sort((x, y) => RANK[x.status] - RANK[y.status] || withinStatus(x, y) || y.score - x.score)
    .map(({ teams, doubles, score, ...s }) => s);
}
