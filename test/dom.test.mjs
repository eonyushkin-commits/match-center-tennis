// Обновление DOM списка матчей по ключам.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { reconcile } from '../src/web/dom.mjs';

function setup() {
  const { document } = parseHTML('<main id="list"></main>');
  return { document, list: document.getElementById('list') };
}
const keys = (parent) => [...parent.children].map((n) => n.dataset.key);

test('reconcile: те же ключи — те же узлы, меняется только содержимое', () => {
  const { list } = setup();
  reconcile(list, [{ key: 'a', html: 'A' }, { key: 'b', html: 'B' }]);
  const [a, b] = list.children;
  reconcile(list, [{ key: 'a', html: 'A2', cls: 'match fav' }, { key: 'b', html: 'B' }]);
  assert.equal(list.children[0], a);
  assert.equal(list.children[1], b);
  assert.equal(a.innerHTML, 'A2');
  assert.equal(a.className, 'match fav');
});

test('reconcile: меняет порядок и удаляет лишние узлы', () => {
  const { list } = setup();
  reconcile(list, [{ key: 'a' }, { key: 'b' }, { key: 'c' }]);
  const [a, b] = list.children;
  reconcile(list, [{ key: 'b' }, { key: 'a' }]);
  assert.deepEqual(keys(list), ['b', 'a']);
  assert.equal(list.children[0], b);
  assert.equal(list.children[1], a);
});

test('reconcile: новые узлы — div или то, что вернёт create', () => {
  const { list } = setup();
  reconcile(list, [{ key: 'lg:47', cls: 'league', create: () => list.ownerDocument.createElement('section') }, { key: 'x' }]);
  assert.deepEqual([...list.children].map((n) => n.tagName), ['SECTION', 'DIV']);
  assert.equal(list.children[0].className, 'league');
});
