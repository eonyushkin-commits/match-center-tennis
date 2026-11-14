// Расписание и счёт тенниса из ESPN (неофициальный API табло, без ключа). Запрос «на день»
// возвращает целиком турниры, которые идут в этот день по американскому времени, со всеми их
// матчами — нужный день выбирает day.mjs. Поэтому, кроме самого дня, спрашиваем соседние:
// ночной матч в США для Москвы уже «завтра», а турнир в ответе на «завтра» может не оказаться.
// Одинаковые запросы, пришедшие одновременно, объединяются; при сбое сети отдаются последние
// полученные данные с пометкой stale: { message, format }, а не ошибка. Форма каждого ответа
// проверяется на входе: см. shape.mjs.
import { FormatError, expect } from './shape.mjs';

const MAX_ENTRIES = 40;
const DAY_TTL_MS = 45e3; // сам день: счёт идущих матчей
const NEAR_TTL_MS = 30 * 60e3; // соседние дни нужны только ради турниров, которых нет в ответе на сам день
const URL_BASE = 'https://site.api.espn.com/apis/site/v2/sports/tennis';
export const TOURS = ['atp', 'wta'];

const need = (ok, what) => expect(ok, 'ESPN', what);

// «20261113» ± n дней
export function shiftYmd(date, n) {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8) + n));
  return d.toISOString().slice(0, 10).replaceAll('-', '');
}

const unfinished = (ev) => (ev.groupings || []).some((g) => (g.competitions || []).some((c) => c.status?.type?.state !== 'post'));

export function createEspn(fetchImpl = fetch) {
  // key → { t, v } | { pending }. t — срок годности (refresh его сбрасывает), а время самого
  // ответа ESPN лежит в v.fetchedAt: чтение кэша и сбой его не меняют
  const cache = new Map();
  const hot = new Set(); // соседние дни, в которых нашёлся свой турнир с несыгранными матчами: их спрашиваем так же часто
  // для диагностики: tour → { okAt, errorAt, error } — время настоящих ответов ESPN, а не чтений кэша
  const health = new Map();
  const note = (tour, patch) => health.set(tour, { okAt: null, errorAt: null, error: null, ...health.get(tour), ...patch });

  async function getJson(url, check) {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(15e3) });
    if (!r.ok) throw new Error(`ESPN ответил ${r.status}`);
    const j = await r.json();
    check(j);
    return j;
  }

  function cached(key, ttlMs, load) {
    const hit = cache.get(key);
    if (hit?.pending) return hit.pending;
    if (hit && Date.now() - hit.t < ttlMs) return Promise.resolve(hit.v);
    const pending = load().then(
      (data) => {
        const t = Date.now();
        const v = { ...data, fetchedAt: t };
        cache.delete(key); // переставляем в конец — самые старые записи удаляются первыми
        cache.set(key, { t, v });
        while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
        return v;
      },
      (e) => {
        if (hit) {
          cache.set(key, hit);
          return { ...hit.v, stale: { message: e.message, format: e instanceof FormatError } };
        }
        cache.delete(key);
        throw e;
      },
    );
    cache.set(key, { ...hit, pending });
    return pending;
  }

  const board = (tour, date, ttlMs) => cached(`${tour}:${date}`, ttlMs, () =>
    getJson(`${URL_BASE}/${tour}/scoreboard?dates=${date}`, (j) => need(Array.isArray(j?.events), 'в табло нет списка events')).then(
      (j) => { note(tour, { okAt: Date.now() }); return j; },
      (err) => { note(tour, { errorAt: Date.now(), error: err.message }); throw err; },
    ));

  async function tourDay(tour, date) {
    const near = [shiftYmd(date, -1), shiftYmd(date, 1)];
    const [main, ...around] = await Promise.all([
      board(tour, date, DAY_TTL_MS),
      // соседний день не ответил — обойдёмся: почти всегда в нём те же турниры
      ...near.map((d) => board(tour, d, hot.has(`${tour}:${d}`) ? DAY_TTL_MS : NEAR_TTL_MS).catch(() => null)),
    ]);
    const seen = new Set(main.events.map((ev) => ev.id));
    const events = [...main.events];
    around.forEach((b, i) => {
      const own = (b?.events || []).filter((ev) => !seen.has(ev.id));
      for (const ev of own) seen.add(ev.id);
      events.push(...own);
      const key = `${tour}:${near[i]}`;
      if (own.some(unfinished)) hot.add(key);
      else hot.delete(key);
    });
    return { events: events.map((ev) => ({ ...ev, tour })), stale: main.stale || null, fetchedAt: main.fetchedAt };
  }

  return {
    health: () => [...health].map(([tour, h]) => ({ tour, ...h })),
    // турниры выбранных туров, идущие около дня date (ГГГГММДД): { events: [{ tour, … }], stale, fetchedAt }.
    // fetchedAt — когда ESPN последний раз ответил на сам день; из нескольких туров — самый давний
    async day(date, tours = TOURS) {
      const parts = await Promise.all(tours.map((tour) => tourDay(tour, date)));
      const stale = parts.map((p) => p.stale).filter(Boolean);
      return {
        events: parts.flatMap((p) => p.events),
        stale: stale.find((s) => s.format) || stale[0] || null, // смена формата важнее сбоя сети
        fetchedAt: Math.min(...parts.map((p) => p.fetchedAt)),
      };
    },
    // «Обновить» по кнопке: табло спросим заново, не дожидаясь срока. Полученное раньше
    // остаётся — его покажем, если ESPN не ответит.
    refresh() {
      for (const hit of cache.values()) hit.t = -Infinity;
    },
  };
}
