// Справочники, которые правятся вручную (docs/REFERENCE-DATA.md): опечатка или неполный
// календарь нового сезона должны падать здесь, а не тихо прятать турниры у пользователей.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (name) => JSON.parse(readFileSync(new URL(`../src/core/${name}`, import.meta.url), 'utf8'));
const LEVELS = {
  atp: ['Grand Slam', 'ATP Finals', 'ATP 1000', 'ATP 500', 'ATP 250'],
  wta: ['Grand Slam', 'WTA Finals', 'WTA 1000', 'WTA 500', 'WTA 250'],
};

for (const [season, data] of Object.entries(read('tournaments.json'))) {
  test(`tournaments.json ${season}: источник, туры, номера и уровни`, () => {
    assert.match(season, /^\d{4}$/);
    assert.ok(Array.isArray(data.source) && data.source.length, 'нужна ссылка на источник календаря');
    for (const tour of ['atp', 'wta']) {
      const list = data[tour];
      assert.ok(Array.isArray(list), `${tour}: нужен список`);
      // в календаре тура 50–70 турниров: заметно меньше — справочник заполнен не целиком
      assert.ok(list.length >= 40 && list.length <= 80, `${tour}: ${list.length} турниров — календарь неполный или лишний`);
      const ids = new Set();
      for (const t of list) {
        assert.match(t.id, /^\d+$/, `${tour}: номер ESPN — только цифры, без сезона («${t.id}»)`);
        assert.ok(!ids.has(t.id), `${tour}: номер ${t.id} дважды`);
        ids.add(t.id);
        assert.ok(LEVELS[tour].includes(t.level), `${tour} ${t.id}: неизвестный уровень «${t.level}»`);
        assert.ok(typeof t.name === 'string' && t.name.trim(), `${tour} ${t.id}: нет названия`);
      }
      const count = (level) => list.filter((t) => t.level === level).length;
      assert.equal(count('Grand Slam'), 4, `${tour}: должно быть 4 турнира Большого шлема`);
      assert.equal(count(LEVELS[tour][1]), 1, `${tour}: должен быть один итоговый турнир`);
    }
  });
}

// [имя, фамилия] или [имя, фамилия, 1]: пометка 1 стоит у китайских имён (порядок «фамилия
// имя») и кодом не читается. Имя может быть пустым (у игрока одно имя), фамилия — нет.
test('players.json: номер ESPN → [имя, фамилия] по-русски', () => {
  const players = Object.entries(read('players.json'));
  assert.ok(players.length > 100);
  const word = /^[А-ЯЁа-яё][А-ЯЁа-яё' -]*[А-ЯЁа-яё]$|^[А-ЯЁа-яё]$/;
  for (const [id, entry] of players) {
    assert.match(id, /^\d+$/, `номер ESPN «${id}»`);
    assert.ok(Array.isArray(entry) && (entry.length === 2 || (entry.length === 3 && entry[2] === 1)), `${id}: нужно [имя, фамилия] или [имя, фамилия, 1]`);
    const [first, last] = entry;
    assert.ok(first === '' || word.test(first), `${id}: имя «${first}» — кириллицей, без пробелов по краям`);
    assert.match(last, word, `${id}: фамилия «${last}» — кириллицей, без пробелов по краям`);
  }
});
