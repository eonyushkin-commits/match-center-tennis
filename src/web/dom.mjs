// Обновление списка по ключам: существующие узлы переиспользуются.
export const setHtml = (node, html) => { if (node._html !== html) { node.innerHTML = html; node._html = html; } };

export function reconcile(parent, items) {
  const want = new Set(items.map((i) => i.key));
  for (const n of [...parent.children]) if (!want.has(n.dataset.key)) n.remove();
  const have = new Map([...parent.children].map((n) => [n.dataset.key, n]));
  let cur = parent.firstElementChild;
  for (const it of items) {
    let n = have.get(it.key);
    if (!n) {
      n = it.create ? it.create() : parent.ownerDocument.createElement('div');
      n.dataset.key = it.key;
    }
    if (it.cls !== undefined && n.className !== it.cls) n.className = it.cls;
    if (it.html !== undefined) setHtml(n, it.html);
    if (n === cur) cur = cur.nextElementSibling;
    else parent.insertBefore(n, cur);
  }
}
