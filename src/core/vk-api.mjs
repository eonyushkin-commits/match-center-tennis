// Чтение эфиров напрямую через API VK Видео — теми же запросами, которые делает страница канала
// для незалогиненного посетителя: анонимный токен → catalog.getVideo → catalog.getSection.
// Меньше секунды на канал; если VK что-то поменяет, опрос переключится на чтение страницы.
import { hasId, idOf, liveStatus, startMs, toItems } from './vk-items.mjs';

// публичные данные веб-клиента vkvideo.ru, их видит любой посетитель сайта
const CLIENT_ID = '52461373';
const CLIENT_SECRET = 'o557NLIkAErNhakXrQ7A';
const APP_ID = '6287487';
const API = 'https://api.vkvideo.ru/method';
const VERSION = '5.289';
const PAGES = 2; // догрузки по 20 эфиров сверх первых трёх — около месяца назад
// Догрузки почти целиком состоят из завершённых записей, которые уже не меняются: читаем их
// не каждый круг, а раз в DEEP_TTL_MS. Исключение — эфир, который идёт или ожидается в ближайшие
// сутки: пока он не встретился в свежих ответах круга, читаем глубже, чтобы не пропустить его начало
// и конец. Эфир, назначенный позже, подождёт полного чтения — за минуту у него ничего не меняется.
const DEEP_TTL_MS = 15 * 60e3;
const SOON_MS = 24 * 3600e3;
// время начала неизвестно — считаем близким; просроченный ожидаемый эфир тоже может начаться в любой момент
const active = (v, at) => {
  const status = v.live_status && liveStatus(v.live_status);
  return status === 'started' || (status === 'upcoming' && !(startMs(v) > at + SOON_MS));
};

export function createVkApi(fetchImpl = fetch, { now = () => Date.now(), deepTtlMs = DEEP_TTL_MS } = {}) {
  const seen = new Map(); // screenName → { videos: Map(id → видео), fullAt } — итог прошлого чтения
  let token = null; // { value, expires }
  let tokenRequest = null; // каналы читаются параллельно — пусть ждут один запрос токена, а не шлют каждый свой

  async function post(url, body) {
    const r = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(15e3),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function getToken() {
    if (token && token.expires - 60e3 > Date.now()) return token.value;
    tokenRequest ??= post('https://login.vk.ru/?act=get_anonym_token', {
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET, app_id: APP_ID, version: '1',
      scopes: 'audio_anonymous,video_anonymous,photos_anonymous,profile_anonymous',
      isApiOauthAnonymEnabled: 'false',
    }).then((j) => {
      const t = j?.data;
      if (!t?.access_token) throw new Error('VK не выдал анонимный токен');
      token = { value: t.access_token, expires: t.expired_at * 1000 };
      return token.value;
    }).finally(() => { tokenRequest = null; });
    return tokenRequest;
  }

  async function call(method, params) {
    const j = await post(`${API}/${method}?v=${VERSION}&client_id=${CLIENT_ID}`, { ...params, access_token: await getToken() });
    if (j.error) {
      if (j.error.error_code === 5) token = null; // токен отозван — в следующий раз возьмём новый
      throw new Error(`${method}: ${j.error.error_msg}`);
    }
    return j.response;
  }

  async function readChannel(ch) {
    const first = await call('catalog.getVideo', { url: `https://vkvideo.ru/@${ch.screenName}/lives`, need_blocks: '1' });
    const fresh = [...(first.videos || [])];
    const catalog = first.catalog;
    const section = catalog?.sections?.find((s) => s.id === catalog.default_section);
    let from = section?.next_from;
    const prev = seen.get(ch.screenName);
    const stale = !prev || now() - prev.fullAt >= deepTtlMs;
    // незавершённые эфиры прошлого чтения, которых ещё нет в свежих ответах этого круга
    const pending = new Set(stale ? [] : [...prev.videos.values()].filter((v) => active(v, now())).map(idOf));
    const settle = (list) => { for (const v of list) pending.delete(idOf(v)); };
    settle(fresh);
    let pages = 0;
    while (from && pages < PAGES && (stale || pending.size)) {
      const page = await call('catalog.getSection', { section_id: section.id, start_from: from });
      fresh.push(...(page.videos || []));
      settle(page.videos || []);
      from = page.section?.next_from;
      pages++;
    }
    // Прочитано всё (догрузки кончились или достигнут предел) — список собирается заново, и удалённые
    // каналом видео пропадают. Иначе свежие ответы ложатся поверх прошлого чтения.
    const full = !from || pages === PAGES;
    const merged = new Map(full ? [] : prev.videos);
    for (const v of fresh) if (hasId(v)) merged.set(idOf(v), v);
    const videos = full ? fresh : [...merged.values()];
    // пустой ответ чаще всего означает гео-ограничение: API отвечает, но без эфиров
    if (!videos.length) throw new Error('канал не вернул ни одного видео (доступ не из России?)');
    if (full || prev) seen.set(ch.screenName, { videos: merged, fullAt: full ? now() : prev.fullAt });
    return toItems(videos, ch);
  }

  return { name: 'api', read: readChannel };
}
