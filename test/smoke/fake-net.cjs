// Подставная сеть для проверок в приложении: ESPN и VK отвечают заранее известным днём.
// Три матча итогового турнира WTA сегодня (по часам компьютера):
//   101 — идёт, два эфира на разных каналах;
//   102 — завершён, есть запись;
//   103 — ещё не начался, эфиров нет.
const HOUR = 3600e3;
const MIN = 60e3;
const PLAYERS = {
  9820: 'Mirra Andreeva', 8017: 'Diana Shnaider', 3038: 'Aryna Sabalenka', 1797: 'Elina Svitolina', 3626: 'Coco Gauff', 2113: 'Jessica Pegula',
};
const VK_TOKEN_DELAY_MS = 3000; // первое чтение каналов тянется: эфиры должны прийти на страницу сами, после расписания

function create(now = Date.now()) {
  // время матчей — от полудня сегодняшнего дня: расписание не зависит от того, в котором часу идёт проверка
  const noon = new Date(now).setHours(12, 0, 0, 0);
  const kickoff = { 101: noon, 102: noon - 3 * HOUR, 103: noon + 3 * HOUR };
  const side = (id, order, games) => ({
    id: String(id), order,
    athlete: { displayName: PLAYERS[id], shortName: `${PLAYERS[id][0]}. ${PLAYERS[id].split(' ')[1]}`, flag: { href: 'https://a.espncdn.com/i/teamlogos/countries/500/xx.png' } },
    linescores: games.map((value) => ({ value })),
  });
  const match = (id, state, name, home, away) => ({
    id: String(id), date: new Date(kickoff[id]).toISOString(), timeValid: true,
    status: { period: home.linescores.length, type: { state, name, detail: 'x' } },
    round: { displayName: 'Group Stage' }, venue: { court: 'Center Court' },
    competitors: [home, away],
  });
  const board = { events: [{ id: '382-2026', name: 'WTA Finals', groupings: [{ grouping: { slug: 'womens-singles' }, competitions: [
    match(101, 'in', 'STATUS_IN_PROGRESS', side(9820, 1, [6, 2]), side(8017, 2, [4, 1])),
    match(102, 'post', 'STATUS_FINAL', { ...side(3038, 1, [6, 6]), winner: true }, { ...side(1797, 2, [3, 4]), winner: false }),
    match(103, 'pre', 'STATUS_SCHEDULED', side(3626, 1, []), side(2113, 2, [])),
  ] }] }] };

  const sec = (ms) => Math.floor(ms / 1000);
  const video = (owner, id, title, o) => ({ owner_id: -owner, id, title, date: sec(noon - 60 * MIN), player: `https://vkvideo.ru/video_ext.php?oid=-${owner}&id=${id}&hash=smoke`, ...o });
  const videos = {
    tennisprimesport: [
      video(1, 1, 'Мирра Андреева - Диана Шнайдер | Комментатор', { live_status: 'started', date: sec(kickoff[101] - 20 * MIN), spectators: 1200 }),
      video(1, 2, 'Арина Соболенко - Элина Свитолина | Комментатор', { live_status: 'postlive', date: sec(kickoff[102] - 10 * MIN), duration: 9000 }),
    ],
    sportcast_tennis: [video(2, 1, 'Мирра Андреева – Диана Шнайдер / Итоговый турнир WTA / Групповой этап', { live_status: 'started', date: sec(kickoff[101] - 5 * MIN), spectators: 300 })],
  };
  const other = [video(9, 9, 'Обзор дня', { live_status: 'postlive' })]; // без игроков — в эфиры не попадёт

  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  let tokenAsked = false;

  // канал завёл эфир к матчу 103 уже после запуска приложения
  fetch.addStream = (channel, owner) => {
    (videos[channel] ||= []).push(video(owner, 3, 'Коко Гауфф — Джессика Пегула | WTA Finals', { live_status: 'upcoming', date: sec(kickoff[103]) }));
  };
  return fetch;

  async function fetch(url, init = {}) {
    const u = new URL(String(url));
    if (u.hostname === 'site.api.espn.com') {
      const tour = /\/tennis\/(\w+)\/scoreboard$/.exec(u.pathname)?.[1];
      if (tour) return json(tour === 'wta' ? board : { events: [] });
    }
    if (u.hostname === 'login.vk.ru') {
      if (!tokenAsked) await new Promise((r) => setTimeout(r, VK_TOKEN_DELAY_MS));
      tokenAsked = true;
      return json({ data: { access_token: 'smoke', expired_at: sec(Date.now()) + 3600 } });
    }
    if (u.hostname === 'api.vkvideo.ru' && u.pathname.endsWith('/catalog.getVideo')) {
      const channel = /@([\w.-]+)\/lives/.exec(new URLSearchParams(init.body).get('url'))?.[1];
      return json({ response: { videos: videos[channel] || other } });
    }
    return new Response('{}', { status: 404 });
  }
}

module.exports = { create };
