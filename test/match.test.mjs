import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNamer, latinize, matchStreams, nameScore, norm, parsePair, parseTeams } from '../src/core/match.mjs';

// Заголовки — настоящие, с каналов в ноябре 2026
test('parseTeams: игроки в любой части заголовка, между «|» или « / »', () => {
  assert.deepEqual(parseTeams('Мирра Андреева - Диана Шнайдер | Марина Бережнова'), ['мирра андреева', 'диана шнайдер']);
  assert.deepEqual(parseTeams('Арина Соболенко – Элина Свитолина / Итоговый турнир WTA / Групповой этап / Смотреть онлайн теннис бесплатно'), ['арина соболенко', 'елина свитолина']);
  assert.deepEqual(parseTeams('Тейлор Фриц х Лоренцо Музетти | ATP 250 Стокгольм | 1/2 финала | Трансляция матча | 19:00'), ['тейлор фриц', 'лоренцо музетти'], 'русская х; «1/2 финала» и время игроками не считаются');
  assert.deepEqual(parseTeams('Мирра Андреева — Диана Шнайдер | WTA Finals | Итоговый турнир'), ['мирра андреева', 'диана шнайдер']);
  assert.deepEqual(parseTeams('Диана Шнайдер - Лейла Фернандес / WTA 500 Токио финал / Смотреть онлайн'), ['диана шнайдер', 'лейла фернандес']);
  assert.deepEqual(parseTeams('Sinner vs Alcaraz (повтор) 2:1'), ['sinner', 'alcaraz']);
  assert.equal(parseTeams('Обзор дня | Итоговый турнир'), null);
});

test('parsePair: пара через косую черту — эфир парного матча', () => {
  assert.deepEqual(parsePair('Гуо/Младенович — Мертенс/Чжан Шуай | WTA Finals'), { teams: ['гуо младенович', 'мертенс чжан шуай'], doubles: true });
  assert.deepEqual(parsePair('Габриэла Дабровски/Луиза Стефани х Шувэй Се/Елена Остапенко | FAGE WTA Finals (пары)').doubles, true);
  assert.equal(parsePair('Арина Соболенко – Элина Свитолина / Итоговый турнир WTA').doubles, false, '« / » с пробелами — разделитель частей заголовка');
  assert.equal(parsePair('Эллен Перес Деми Схюрс - Сара Эррани Жасмин Паолини').doubles, false, 'пара без косой черты узнаётся по именам');
});

test('norm: ё и э, регистр, знаки, латиница со значками', () => {
  assert.equal(norm('  Оже-Альяссим!  '), 'оже альяссим');
  assert.equal(norm('Рублёв'), 'рублев');
  assert.equal(norm('Баэс'), norm('Баес'));
  assert.equal(norm('Се Шувэй'), norm('Се Шувей'));
  assert.equal(norm('Frantzén'), 'frantzen');
  assert.equal(norm('Йович'), 'йович', 'й остаётся буквой');
  assert.equal(latinize('басаваредди'), 'basavareddi');
});

test('nameScore: лишние слова в заголовке не мешают, опечатки прощаются', () => {
  assert.ok(nameScore('свитолина', 'елина свитолина итоговый турнир wta') >= 0.9);
  assert.ok(nameScore('мирра андреева', 'андреева') >= 0.9, 'в заголовке только фамилия');
  assert.ok(nameScore('меличар мартинес', 'меличар') >= 0.9, 'часть двойной фамилии');
  assert.ok(nameScore('дабровски', 'дабровский') > 0.72);
  assert.equal(nameScore('соболенко', 'свитолина'), 0);
  assert.equal(nameScore('арина соболенко', 'арина родионова'), 0, 'одного имени мало');
});

const P = {
  andreeva: { name: 'Мирра Андреева', last: 'Андреева', enName: 'Mirra Andreeva', enLast: 'Andreeva' },
  shnaider: { name: 'Диана Шнайдер', last: 'Шнайдер', enName: 'Diana Shnaider', enLast: 'Shnaider' },
  sabalenka: { name: 'Арина Соболенко', last: 'Соболенко', enName: 'Aryna Sabalenka', enLast: 'Sabalenka' },
  guo: { name: 'Ханьюй Го', last: 'Го', enName: 'Guo Hanyu', enLast: 'Guo' },
  mladenovic: { name: 'Кристина Младенович', last: 'Младенович', enName: 'Kristina Mladenovic', enLast: 'Mladenovic' },
  mertens: { name: 'Элизе Мертенс', last: 'Мертенс', enName: 'Elise Mertens', enLast: 'Mertens' },
  zhang: { name: 'Шуай Чжан', last: 'Чжан', enName: 'Zhang Shuai', enLast: 'Zhang' },
  unknown: { enName: 'Nishesh Basavareddy', enLast: 'Basavareddy' }, // в словаре русских имён его нет
  altmaier: { enName: 'Daniel Altmaier', enLast: 'Altmaier' },
};
const namer = createNamer({ 'Соболенко': ['Сабаленка'], 'Го': ['Гуо'] });
const sideOf = (...players) => players.map(namer);
const K = '2026-11-13T20:10:00Z';
const match = (o = {}) => ({ utcTime: K, finished: false, doubles: false, ...o });
const stream = (title, extra = {}) => ({
  title, ...(({ teams, doubles }) => ({ teams, doubles }))(parsePair(title)), status: 'finished', time: Date.parse(K) - 3600e3, channel: 'X', url: title, ...extra,
});
const titles = (list) => list.map((s) => s.title);

test('matchStreams: находит эфир по русским именам, по фамилиям, по алиасу и с переставленными игроками', () => {
  const found = matchStreams(match(), sideOf(P.andreeva), sideOf(P.sabalenka), [
    stream('Мирра Андреева - Арина Соболенко | Комментатор'),
    stream('Сабаленка х Андреева | повтор'),
    stream('Sabalenka vs Andreeva'),
    stream('Мирра Андреева — Диана Шнайдер | WTA Finals'),
    stream('Эрика Андреева — Диана Шнайдер'),
  ]);
  assert.deepEqual(titles(found), ['Мирра Андреева - Арина Соболенко | Комментатор', 'Сабаленка х Андреева | повтор', 'Sabalenka vs Andreeva']);
});

test('matchStreams: игрока без русского имени в словаре узнаёт по латинице', () => {
  const found = matchStreams(match(), sideOf(P.unknown), sideOf(P.altmaier), [
    stream('Нишеш Басаваредди х Даниэль Альтмайер | Challenger 125 Орлеан'),
    stream('Том Генч х Нишеш Басаваредди | Challenger 125 Орлеан'),
  ]);
  assert.deepEqual(titles(found), ['Нишеш Басаваредди х Даниэль Альтмайер | Challenger 125 Орлеан']);
});

test('matchStreams: пара — в заголовке должны быть оба игрока каждой стороны', () => {
  const home = sideOf(P.guo, P.mladenovic), away = sideOf(P.mertens, P.zhang);
  const found = matchStreams(match({ doubles: true }), home, away, [
    stream('Гуо/Младенович — Мертенс/Чжан Шуай | WTA Finals'),
    stream('Ханью Го/Кристина Младенович х Элизе Мертенс/Чжан Шуай | FAGE WTA Finals (пары)'),
    stream('Ханью Гуо Кристина Младенович - Элизе Мертенс Чжан Шуай'),
    stream('Кристина Младенович — Элизе Мертенс'),
  ]);
  assert.equal(found.length, 3, 'одиночный матч тех же фамилий к паре не привязан');
});

test('matchStreams: эфир пары не привязывается к одиночному матчу тех же фамилий', () => {
  const found = matchStreams(match(), sideOf(P.mladenovic), sideOf(P.mertens), [
    stream('Гуо/Младенович — Мертенс/Чжан Шуай | WTA Finals'),
    stream('Кристина Младенович — Элизе Мертенс'),
  ]);
  assert.deepEqual(titles(found), ['Кристина Младенович — Элизе Мертенс']);
});

test('matchStreams: резерв у завершённого матча и эфиры не того времени отбрасываются', () => {
  const found = matchStreams(match({ finished: true }), sideOf(P.andreeva), sideOf(P.shnaider), [
    stream('РЕЗЕРВ. Мирра Андреева – Диана Шнайдер', { status: 'upcoming' }),
    stream('Мирра Андреева – Диана Шнайдер | групповой этап, четыре дня назад', { time: Date.parse(K) - 4 * 24 * 3600e3 }),
    stream('Мирра Андреева – Диана Шнайдер | финал, через день', { time: Date.parse(K) + 24 * 3600e3 }),
    stream('Мирра Андреева – Диана Шнайдер | без даты', { time: null }),
  ]);
  assert.deepEqual(titles(found), ['Мирра Андреева – Диана Шнайдер | без даты']);
});

test('matchStreams: сначала идущие, потом запланированные, потом записи', () => {
  const found = matchStreams(match(), sideOf(P.andreeva), sideOf(P.shnaider), [
    stream('Андреева — Шнайдер | запись', { status: 'finished' }),
    stream('Андреева — Шнайдер | скоро', { status: 'upcoming' }),
    stream('Андреева — Шнайдер | идёт', { status: 'started' }),
  ]);
  assert.deepEqual(found.map((s) => s.status), ['started', 'upcoming', 'finished']);
  assert.equal('teams' in found[0] || 'doubles' in found[0], false, 'служебные поля не уходят в ответ');
});
