// Разбор видео VK в эфиры матч-центра — общий для API и для чтения страницы канала.
import { parsePair } from './match.mjs';
import { expect, isObject } from './shape.mjs';

export const hasId = (v) => isObject(v) && Number.isFinite(v.owner_id) && Number.isFinite(v.id);
export const idOf = (v) => `${v.owner_id}_${v.id}`;
const known = (v) => hasId(v) && typeof v.title === 'string';
// начало эфира, мс; у видео без назначенного времени — дата создания
export const startMs = (v) => (v.live_start_time || v.date) * 1000 || null;

// live_status из ответов vkvideo.ru → наши статусы
export function liveStatus(s) {
  if (s === 'started') return 'started';
  if (s === 'upcoming' || s === 'waiting') return 'upcoming';
  if (s === 'failed') return 'failed';
  return 'finished'; // postlive, finished
}

export function toItems(videos, ch) {
  // обычные видео без live_status — норма, а вот ни одного видео с номером и названием — нет
  expect(!videos.length || videos.some(known), 'VK', 'у видео нет owner_id, id или title');
  // одно видео может прийти несколько раз (повторные запросы страницы) — берём последнюю версию
  const unique = new Map(videos.map((v) => [idOf(v), v]));
  return [...unique.values()]
    .filter((v) => v.live_status && v.title)
    .map((v) => {
      const pair = parsePair(v.title);
      return {
        title: v.title,
        url: `https://vkvideo.ru/live${v.owner_id}_${v.id}`,
        embed: v.player || null, // официальная ссылка для встраивания, с hash
        status: liveStatus(v.live_status),
        time: startMs(v),
        created: v.date ? v.date * 1000 : null, // когда канал создал видео — по нему упорядочены записи
        spectators: Number.isFinite(v.spectators) ? v.spectators : null, // смотрят прямо сейчас — только у эфиров
        duration: v.duration > 0 ? v.duration : null, // длина записи, с
        channel: ch.label || ch.screenName,
        teams: pair?.teams ?? null,
        doubles: !!pair?.doubles, // эфир парного матча: «Гуо/Младенович — Мертенс/Чжан Шуай»
      };
    })
    .filter((s) => s.teams);
}
