// Лента для страницы. Страница не опрашивает сервер: она подписывается на день, а ядро само
// присылает расписание и состояние каналов — сразу и потом каждый раз, когда они меняются.
// Счёт у ESPN приходится спрашивать по часам, эфиры и настройки сообщают о себе сами.
import { buildDay, toursOf } from './day.mjs';

// dayMs — как часто спрашиваем счёт: реже, чем живёт кэш табло (45 с), иначе круг впустую
export function createFeed({ settings, poller, espn, version, dayMs = 60e3, retryMs = 15e3 }) {
  const stops = new Set();

  // send(event, json): status | day | day-error. Возвращает отписку.
  function subscribe({ date, tz }, send) {
    // канал (status, day) → что отправили последним: то же самое повторно не шлём.
    // Успех и ошибка — два события одного канала, поэтому успех после сбоя уходит заново.
    const sent = {};
    let timer = null;
    let stopped = false;

    const push = (channel, event, data) => {
      if (stopped) return;
      const body = JSON.stringify(data);
      if (sent[channel] === event + body) return;
      sent[channel] = event + body;
      send(event, body);
    };

    const status = () => {
      const { streams, ...vk } = poller.snapshot();
      push('status', 'status', { version, vk: { ...vk, streamCount: streams.length }, warnings: settings.warnings });
    };
    const day = async () => {
      status();
      try {
        const s = settings.get();
        const data = await espn.day(date, toursOf(s.leagues));
        push('day', 'day', buildDay({ data, date, tz, settings: s, snapshot: poller.snapshot() }));
        return true;
      } catch (e) {
        push('day', 'day-error', { message: e.message });
        return false;
      }
    };

    // сразу и дальше по часам; после сбоя — повтор через retryMs
    async function loop() {
      const ok = await day();
      if (!stopped) timer = setTimeout(loop, ok ? dayMs : retryMs);
    }
    loop();
    // прочитаны каналы или сохранены настройки — расписание сразу, не дожидаясь круга.
    // Размер окна, тема и фильтры на расписание не влияют: ради них ESPN не спрашиваем.
    const dayKey = (s) => JSON.stringify([s.leagues, s.favorites, s.favoriteMatches, s.teamAliases]);
    const changed = (s, prev) => (s && prev && dayKey(s) === dayKey(prev) ? status() : day());
    poller.on('update', day);
    settings.on('change', changed);

    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      poller.off('update', day);
      settings.off('change', changed);
      stops.delete(stop);
    };
    stops.add(stop);
    return stop;
  }

  return {
    subscribe,
    close() {
      for (const stop of [...stops]) stop();
    },
  };
}
