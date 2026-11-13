// Что раскрыто в списке матчей: встроенный плеер. Без DOM.
// Строка — ключ «m:<id матча>» или «live:<id матча>». Эфир — его ссылка: номер кнопки меняется,
// когда эфиры переупорядочиваются, а ссылка у эфира одна.
export const matchIdOf = (rowKey) => Number(rowKey.split(':')[1]);

export function createOpened() {
  let player = null; // { rowKey, url }

  return {
    get player() { return player; },

    // встроенный плеер один
    play(rowKey, url) {
      player = { rowKey, url };
    },
    stop() {
      player = null;
    },
    isPlaying: (rowKey, url) => player?.rowKey === rowKey && player.url === url,
    // другой день: плеер закрывается, а окна «в окне» живут дальше
    leaveDay() {
      player = null;
    },

    // строки, которые не прячет никакой фильтр
    pinned: () => new Set([player?.rowKey].filter(Boolean)),
    // что показать под строкой матча
    under: (rowKey) => (player?.rowKey === rowKey ? ['player'] : []),
  };
}
