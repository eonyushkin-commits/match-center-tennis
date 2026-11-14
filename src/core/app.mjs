// Всё ядро вместе: настройки, опрос каналов, ESPN, сервер и уведомления.
import { coreDiagnostics } from './diagnostics.mjs';
import { createFeed } from './feed.mjs';
import { createEspn } from './espn.mjs';
import { createHandler, startServer } from './server.mjs';
import { openSettings } from './settings.mjs';
import { createStreamPoller } from './streams.mjs';
import { createVkApi } from './vk-api.mjs';
import { watchFavorites } from './watch.mjs';

// fetchImpl — для VK (в приложении — сетевой стек Chromium), espnFetch — для ESPN: запросы Chromium
// со стандартным User-Agent Electron ESPN отклоняет (403), а встроенный fetch Node.js принимает
export async function createMatchCenter({ dataDir, fetchImpl = fetch, espnFetch = fetch, pageReader = null, version }) {
  const settings = await openSettings(dataDir);
  const readers = [createVkApi(fetchImpl), pageReader].filter(Boolean);
  const poller = createStreamPoller({
    channels: () => settings.get().channels.filter((c) => c.enabled),
    intervalMs: () => settings.get().refreshSeconds * 1000,
    readers,
  });
  const espn = createEspn(espnFetch);

  settings.on('change', () => poller.sync());

  const listeners = new Set();
  const watcher = watchFavorites({ poller, settings, espn, onEvent: (event) => listeners.forEach((fn) => fn(event)) });
  const feed = createFeed({ settings, poller, espn, version });

  const { server, url } = await startServer(createHandler({ settings, poller, espn, feed }));
  poller.refresh();

  return {
    settings,
    url,
    // уведомления о матчах избранных: { kind: soon | kickoff, date, match }
    onNotify: (fn) => listeners.add(fn),
    // состояние источников для диагностического отчёта (см. diagnostics.mjs)
    diagnostics: () => coreDiagnostics({ settings, poller, espn }),
    close() {
      poller.stop();
      watcher.stop();
      feed.close();
      server.close();
      server.closeAllConnections(); // открытые ленты страницы
    },
  };
}
