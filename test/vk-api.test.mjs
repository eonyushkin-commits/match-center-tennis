// Чтение каналов через API VK Видео: токен, ошибки API и HTTP, пустые и короткие ответы.
// Общий токен для параллельных каналов и редкие догрузки проверяются в streams.test.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVkApi } from '../src/core/vk-api.mjs';

const video = (id, status = 'started') => ({ owner_id: -1, id, title: 'Синнер — Алькарас', live_status: status, date: 1758380000 + id });
const goodToken = (value = 't1', ttlS = 3600) => ({ data: { access_token: value, expired_at: Date.now() / 1000 + ttlS } });
const page = (videos, nextFrom) => ({ response: { videos, catalog: { default_section: 's', sections: [{ id: 's', next_from: nextFrom }] } } });

// Подставной VK: token() и getVideo(token) возвращают тело ответа или { status } для HTTP-ошибки
function fakeVk({ token = () => goodToken(), getVideo = () => page([video(1)]), getSection = () => ({ response: { videos: [] } }) } = {}) {
  const calls = { token: 0, getVideo: [], getSection: 0 };
  const fetchImpl = async (url, o) => {
    let body;
    if (url.includes('get_anonym_token')) {
      calls.token++;
      body = token(calls.token);
    } else if (url.includes('catalog.getVideo')) {
      const used = new URLSearchParams(o.body).get('access_token');
      calls.getVideo.push(used);
      body = getVideo(used, calls.getVideo.length);
    } else {
      calls.getSection++;
      body = getSection(calls.getSection);
    }
    if (body?.status) return { ok: false, status: body.status, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
  return { calls, fetchImpl };
}

test('VK API: отозванный токен (код 5) — ошибка чтения, следующее чтение берёт новый токен', async () => {
  const { calls, fetchImpl } = fakeVk({
    token: (n) => goodToken(`t${n}`),
    getVideo: (used) => (used === 't1' ? { error: { error_code: 5, error_msg: 'User authorization failed' } } : page([video(1)])),
  });
  const api = createVkApi(fetchImpl);
  await assert.rejects(api.read({ screenName: 'a' }), /catalog\.getVideo: User authorization failed/);
  const items = await api.read({ screenName: 'a' });
  assert.equal(items.length, 1);
  assert.deepEqual([calls.token, calls.getVideo], [2, ['t1', 't2']]);
});

test('VK API: другая ошибка API — сообщение с методом, токен не сбрасывается', async () => {
  const { calls, fetchImpl } = fakeVk({
    getVideo: (_used, n) => (n === 1 ? { error: { error_code: 6, error_msg: 'Too many requests per second' } } : page([video(1)])),
  });
  const api = createVkApi(fetchImpl);
  await assert.rejects(api.read({ screenName: 'a' }), /^Error: catalog\.getVideo: Too many requests per second$/);
  assert.equal((await api.read({ screenName: 'a' })).length, 1);
  assert.equal(calls.token, 1, 'тот же токен');
});

test('VK API: токен не выдан — понятная ошибка, следующее чтение спрашивает токен заново', async () => {
  const { calls, fetchImpl } = fakeVk({ token: (n) => (n === 1 ? { data: {} } : goodToken()) });
  const api = createVkApi(fetchImpl);
  await assert.rejects(api.read({ screenName: 'a' }), /VK не выдал анонимный токен/);
  assert.equal(calls.getVideo.length, 0, 'без токена каталог не спрашиваем');
  assert.equal((await api.read({ screenName: 'a' })).length, 1);
  assert.equal(calls.token, 2);
});

test('VK API: истёкший токен (меньше минуты до срока) заменяется новым', async () => {
  const { calls, fetchImpl } = fakeVk({ token: (n) => goodToken(`t${n}`, n === 1 ? 30 : 3600) });
  const api = createVkApi(fetchImpl);
  await api.read({ screenName: 'a' });
  await api.read({ screenName: 'a' });
  assert.deepEqual(calls.getVideo, ['t1', 't2']);
});

test('VK API: HTTP-ошибка — «HTTP 503» и у токена, и у каталога', async () => {
  const tokenDown = fakeVk({ token: () => ({ status: 503 }) });
  await assert.rejects(createVkApi(tokenDown.fetchImpl).read({ screenName: 'a' }), /^Error: HTTP 503$/);
  const apiDown = fakeVk({ getVideo: () => ({ status: 503 }) });
  await assert.rejects(createVkApi(apiDown.fetchImpl).read({ screenName: 'a' }), /^Error: HTTP 503$/);
});

test('VK API: канал без видео — подсказка про доступ не из России', async () => {
  const { fetchImpl } = fakeVk({ getVideo: () => page([]) });
  await assert.rejects(createVkApi(fetchImpl).read({ screenName: 'a' }), /канал не вернул ни одного видео \(доступ не из России\?\)/);
});

test('VK API: без next_from догрузок нет, чтение полное — ушедшее с канала видео пропадает', async () => {
  let videos = [video(1), video(2, 'postlive')];
  const { calls, fetchImpl } = fakeVk({ getVideo: () => ({ response: { videos } }) });
  const api = createVkApi(fetchImpl);
  assert.equal((await api.read({ screenName: 'a' })).length, 2);
  videos = [video(1)];
  assert.deepEqual((await api.read({ screenName: 'a' })).map((s) => s.url), ['https://vkvideo.ru/live-1_1']);
  assert.equal(calls.getSection, 0);
});
