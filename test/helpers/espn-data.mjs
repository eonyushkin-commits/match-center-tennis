// Данные в форме табло ESPN — для тестов. Игроки — настоящие номера ESPN (они же ключи players.json).
export const ANDREEVA = [9820, 'Mirra Andreeva'];
export const SHNAIDER = [8017, 'Diana Shnaider'];
export const SABALENKA = [3038, 'Aryna Sabalenka'];
export const SVITOLINA = [1797, 'Elina Svitolina'];
export const FRITZ = [2946, 'Taylor Fritz'];
export const MUSETTI = [3764, 'Lorenzo Musetti'];
export const ERRANI = [636, 'Sara Errani'];
export const PAOLINI = [2615, 'Jasmine Paolini'];
export const SINIAKOVA = [2248, 'Katerina Siniakova'];
export const TOWNSEND = [2114, 'Taylor Townsend'];

const short = (name) => `${name[0]}. ${name.split(' ').slice(1).join(' ')}`;
const flag = { href: 'https://a.espncdn.com/i/teamlogos/countries/500/xx.png' };

export const single = ([id, name], extra = {}) => ({ id: String(id), athlete: { displayName: name, shortName: short(name), flag }, ...extra });
export const pair = (a, b, extra = {}) => ({
  id: `${a[0]}-${b[0]}`,
  roster: {
    shortDisplayName: `${short(a[1])} / ${short(b[1])}`,
    athletes: [a, b].map(([id, name]) => ({ displayName: name, shortName: short(name), flag, links: [{ href: `https://www.espn.com/tennis/player/_/id/${id}/x` }] })),
  },
  ...extra,
});
export const tbd = () => ({ id: '-3', athlete: { displayName: 'TBD' } });

const STATUS = { pre: 'STATUS_SCHEDULED', in: 'STATUS_IN_PROGRESS', post: 'STATUS_FINAL' };
const line = (v) => (typeof v === 'object' ? v : { value: v });

// sets — геймы по сетам у каждой стороны: [[6, 7], [4, 5]]; тай-брейк — { value: 7, tiebreak: 7 }
export function comp(id, date, home, away, { state = 'pre', name = STATUS[state], sets = [[], []], winner = null, round = 'Final', court = 'Center Court', serving = null, ...extra } = {}) {
  const side = (p, i) => ({
    ...p, order: i + 1, linescores: sets[i].map(line),
    ...(winner === null ? {} : { winner: winner === i }),
    ...(serving === null ? {} : { possession: serving === i }),
  });
  return {
    id: String(id), date, timeValid: true,
    status: { period: sets[0].length, type: { state, name, detail: state === 'pre' ? 'Fri, November 13th at 4:30 PM EST' : 'x' } },
    round: { displayName: round }, venue: { court },
    competitors: [side(away, 1), side(home, 0)], // как в ESPN: порядок в списке не совпадает с order
    ...extra,
  };
}

export const event = (id, name, groupings) => ({
  id, name,
  groupings: Object.entries(groupings).map(([slug, competitions]) => ({ grouping: { slug }, competitions })),
});

// ответ espn.day: турниры по турам → { events, stale }
export const board = (byTour, stale = null) => ({
  events: Object.entries(byTour).flatMap(([tour, events]) => events.map((ev) => ({ ...ev, tour }))),
  stale,
});
