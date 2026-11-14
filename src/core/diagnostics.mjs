// Диагностический отчёт для «Скопировать отчёт»: версия, ОС, состояние источников, время
// успешных запросов и ошибки. Отчёт отправляют другим людям, поэтому в него не попадают
// пути с именем пользователя, URL с параметрами, токены, e-mail и содержимое настроек —
// только счётчики. Весь готовый текст ещё раз проходит через sanitize.

const MAX_ERROR = 300;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Путь или слово целиком, в любом регистре; в пути разделители \ и / равнозначны
// (C:\Users\x = c:/users/x). Целиком — чтобы свой канал «tennis» не задел «tennisprimesport»
function literalPattern(p) {
  const parts = p.split(/[\\/]+/).filter(Boolean).map(escapeRe);
  const lead = /^[\\/]/.test(p) ? '[\\\\/]' : '';
  return new RegExp(`(?<![\\p{L}\\p{N}_])${lead}${parts.join('[\\\\/]+')}(?![\\p{L}\\p{N}_])`, 'giu');
}

// replace — [[подпись, путь или слово], …]: известные папки (<userData>, ~) и имена своих
// каналов («свой канал 1») заменяются подписью
export function sanitize(text, { replace = [] } = {}) {
  let s = String(text ?? '');
  // длинные первыми: <userData> внутри домашней папки не должен стать «~\AppData\…»
  const known = replace.filter(([, p]) => p?.length >= 2).sort((a, b) => b[1].length - a[1].length);
  for (const [label, p] of known) s = s.replace(literalPattern(p), label);
  // любые другие домашние папки
  s = s.replace(/\b([A-Z]:[\\/]+(?:Users|Documents and Settings)[\\/]+)[^\\/\s"'<>:]+/gi, '$1<user>');
  s = s.replace(/(^|[\s"'(=])(\/(?:home|Users)\/)[^/\s"'<>]+/g, '$1$2<user>');
  // URL — без параметров и якоря: в них бывают подписи и токены
  s = s.replace(/\b((?:https?|wss?|file):\/\/[^\s"'<>?#]*)[?#][^\s"'<>]*/gi, '$1?…');
  s = s.replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer <скрыто>');
  s = s.replace(/\b(access_token|refresh_token|token|client_secret|secret|signature|sign|password|key)(["']?\s*[:=]\s*["']?)[^\s&"',;}]+/gi, '$1$2<скрыто>');
  s = s.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<e-mail>');
  return s;
}

const at = (t) => (Number.isFinite(t) && t > 0 ? new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z') : '—');
const short = (e) => {
  const s = String(e ?? '').replace(/\s+/g, ' ').trim();
  return s.length > MAX_ERROR ? `${s.slice(0, MAX_ERROR)}…` : s;
};

// Состояние ядра: счётчики настроек, предупреждения, каналы VK и ESPN.
// private — имена и подписи своих каналов пользователя: buildReport заменит их везде,
// в том числе в текстах ошибок, на «свой канал N».
export function coreDiagnostics({ settings, poller, espn, now = Date.now() }) {
  const s = settings.get();
  const own = s.channels.filter((c) => !c.builtIn);
  return {
    now,
    settings: {
      channels: s.channels.length,
      enabled: s.channels.filter((c) => c.enabled).length,
      own: own.length,
      leagues: s.leagues.length,
      favorites: s.favorites.length,
      favoriteMatches: s.favoriteMatches.length,
      ownAliases: Object.keys(s.userAliases).length,
    },
    warnings: [...settings.warnings],
    vk: poller.snapshot(),
    espn: espn.health(),
    private: own.flatMap((c, i) => [[`свой канал ${i + 1}`, c.screenName], [`свой канал ${i + 1}`, c.label]]),
  };
}

// app — { name, version, packaged, electron, chrome, node, os }; core — coreDiagnostics();
// paths — [[подпись, путь], …] для sanitize
export function buildReport({ app, core }, { paths = [] } = {}) {
  // шапка — без замены имён своих каналов: подпись «Теннис» не должна задеть название приложения
  const head = [
    `${app.name} — диагностический отчёт`,
    `Создан: ${at(core.now)} (время везде UTC)`,
    `Версия: ${app.version} (${app.packaged ? 'установленная' : 'запуск из исходников'})`,
    `Electron ${app.electron} · Chromium ${app.chrome} · Node.js ${app.node}`,
    `ОС: ${app.os}`,
  ];
  const lines = [];
  const add = (...l) => lines.push(...l);
  const { settings: c } = core;
  add(
    '',
    'Настройки (только счётчики):',
    `  каналов: ${c.channels}, включено: ${c.enabled}, своих: ${c.own}`,
    `  разрядов: ${c.leagues}; избранных игроков: ${c.favorites}; отмеченных матчей: ${c.favoriteMatches}; своих написаний: ${c.ownAliases}`,
  );
  add('', core.warnings.length ? 'Предупреждения:' : 'Предупреждения: нет');
  for (const w of core.warnings) add(`  - ${short(w)}`);

  add('', 'ESPN:');
  if (!core.espn.length) add('  запросов ещё не было');
  for (const e of core.espn) {
    add(`  ${e.tour}: последний успех ${at(e.okAt)}; последняя ошибка ${e.errorAt ? `${at(e.errorAt)} — ${short(e.error)}` : 'нет'}`);
  }

  const vk = core.vk;
  add('', `VK: ${vk.ready ? `круг чтения завершён ${at(vk.updatedAt)}` : 'первое чтение ещё идёт'}`);
  if (!vk.channels.length) add('  включённых каналов нет');
  for (const ch of vk.channels) {
    const state = ch.ok === null ? 'ждёт ' : ch.ok ? 'ok   ' : 'сбой ';
    const parts = [
      ch.ok ? `через ${ch.via}` : null,
      `эфиров ${ch.count}`,
      `проверен ${at(ch.checkedAt)}`,
      `данные от ${at(ch.okAt)}`,
      ch.fails ? `неудач запасного чтения подряд ${ch.fails}` : null,
      ch.pausedUntil ? `запасное чтение на паузе до ${at(ch.pausedUntil)}` : null,
    ].filter(Boolean);
    add(`  ${state}${ch.screenName}: ${parts.join(', ')}`);
    if (ch.error) add(`        ошибка: ${short(ch.error)}`);
  }
  return `${sanitize(head.join('\n'), { replace: paths })}\n${sanitize(lines.join('\n'), { replace: [...paths, ...core.private] })}\n`;
}
