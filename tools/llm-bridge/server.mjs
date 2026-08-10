// Мост «подписка Claude → сайт». Крошечный сервис НА ХОСТЕ, оборачивает
// `claude -p` (headless, авторизация из ~/.claude). Без зависимостей.
//
// Запуск: BRIDGE_TOKEN=... node server.mjs
import http from 'node:http';
import { execFile } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { createLimiter } from './limiter.mjs';

const PORT = Number(process.env.BRIDGE_PORT || 8788);
// Только шлюз docker-сети, никогда 0.0.0.0. У steam-psycho сеть своя (172.19.0.1),
// а не docker0 — адрес подставляет deploy/llm-bridge-setup.sh.
const HOST = process.env.BRIDGE_HOST || '127.0.0.1';
const TOKEN = process.env.BRIDGE_TOKEN || '';

// Защита от секрета, который никогда не совпадёт. Node.js разбирает значения
// HTTP-заголовков как latin1, а process.env отдаёт корректную utf-8 строку.
// Если BRIDGE_TOKEN содержит символы вне ASCII (например кириллицу), байты
// заголовка x-bridge-token после latin1-декодирования дают другую JS-строку,
// и сравнение `!== TOKEN` не совпадёт никогда — ни разу, ни у одного
// клиента. Снаружи это выглядит как вечный 401 без единой зацепки на
// причину: секрет вроде правильный, а мост всё равно отказывает. Тихо
// продолжать работу с таким секретом нельзя — отказываем в старте сразу,
// с понятным объяснением, а не роняем клиентов в необъяснимый 401 в проде.
if (TOKEN && /[^\x00-\x7F]/.test(TOKEN)) {
  console.error(
    'BRIDGE_TOKEN содержит символы вне ASCII (например кириллицу). ' +
    'Node.js разбирает значения HTTP-заголовков как latin1, а не как ' +
    'utf-8, поэтому заголовок x-bridge-token НИКОГДА не совпадёт с таким ' +
    'секретом — мост будет вечно отвечать 401, и причину не будет видно ' +
    'снаружи. Задайте BRIDGE_TOKEN из ASCII-символов, например: ' +
    'openssl rand -hex 32',
  );
  process.exit(1);
}

const TIMEOUT = Number(process.env.BRIDGE_TIMEOUT_MS || 180000);
const HEALTH_TTL = Number(process.env.BRIDGE_HEALTH_TTL_MS || 60000);
// Подписка по умолчанию отдаёт Opus 4.8 с окном в миллион токенов — для
// карточки это избыточно, а лимит Max он ест соответственно. Sonnet измерен
// на этой же машине и справляется. Образец в projectlevin модель не
// пробрасывает вообще, из-за чего всё идёт на самой тяжёлой.
const MODEL = process.env.BRIDGE_MODEL || 'claude-sonnet-5';

const limiter = createLimiter({
  maxConcurrent: Number(process.env.BRIDGE_MAX_CONCURRENT || 2),
  queueMax: Number(process.env.BRIDGE_QUEUE_MAX || 4),
});

// Бинарь резолвим на каждый вызов: расширение VS Code обновляется и удаляет
// старый путь. Это readdir одного каталога — при нашем трафике копейки.
function resolveClaudeBin() {
  if (process.env.CLAUDE_BIN && existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
  const base = `${process.env.HOME || '/root'}/.vscode-server/extensions`;
  try {
    const dirs = readdirSync(base).filter((d) => d.startsWith('anthropic.claude-code-')).sort();
    for (const d of dirs.reverse()) {
      const p = `${base}/${d}/resources/native-binary/claude`;
      if (existsSync(p)) return p;
    }
  } catch { /* каталога нет — идём на PATH */ }
  return 'claude';
}

function runClaude({ system, prompt }, timeoutMs, cb) {
  const bin = resolveClaudeBin();
  // Промпт через stdin, а не аргументом: текст, начинающийся с дефиса
  // (например markdown-разделитель), claude принимает за флаг и падает.
  // Плюс нет предела длины аргументов.
  const args = ['-p', '--output-format', 'json', '--allowedTools', '', '--model', MODEL];
  if (system) args.push('--append-system-prompt', String(system));

  // CLAUDECODE выставлен, если мост запущен из сессии Claude Code — вложенный
  // запуск такой сессии запрещён и падает с ошибкой.
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_SSE_PORT;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  // Свой домашний каталог: иначе claude подхватит плагины, навыки и хук
  // старта сессии владельца. Хук вставляет в каждую генерацию текст про
  // суперспособности — в промпте про карточку это шум, который портит текст.
  // Авторизацию кладёт туда deploy/llm-bridge-setup.sh.
  if (process.env.BRIDGE_HOME) env.HOME = process.env.BRIDGE_HOME;

  const child = execFile(bin, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, env },
    (err, stdout, stderr) => {
      if (!stdout) {
        return cb(new Error(`claude не ответил: ${err?.message || ''} ${String(stderr || '').slice(0, 300)}`));
      }
      try {
        const j = JSON.parse(stdout);
        if (j.is_error) return cb(new Error(`claude вернул ошибку: ${j.subtype || ''} ${String(j.result || '').slice(0, 300)}`));
        cb(null, { text: String(j.result ?? ''), model: j.modelUsage ? Object.keys(j.modelUsage)[0] : '' });
      } catch (e) {
        cb(new Error('не разобрал ответ claude: ' + e.message));
      }
    });
  child.stdin.on('error', () => {}); // не падать на EPIPE
  child.stdin.end(String(prompt || ''));
  // Отдаём процесс наружу, чтобы вызывающий мог убить его, если клиент
  // (сайт) оборвёт соединение раньше, чем claude ответит.
  return child;
}

// --- проверка живости ---
// Смотреть только наличие бинаря нельзя: протухшая авторизация выглядит как
// здоровый сервис. Поэтому делаем настоящий короткий запрос — но ТОЛЬКО по
// запросу и с кешем, потому что каждый такой вызов тратит лимит подписки.
// Никаких таймеров и внешних опросов заводить нельзя.
let healthCache = { at: 0, value: null };
// Список ожидающих колбэков ТЕКУЩЕГО настоящего вызова claude, или null,
// если сейчас никакой реальный запрос не выполняется.
let healthInFlight = null;

function markAlive() {
  healthCache = { at: Date.now(), value: { status: 'ok', bin: resolveClaudeBin() } };
}

function checkHealth(cb) {
  const bin = resolveClaudeBin();
  if (bin !== 'claude' && !existsSync(bin)) return cb({ status: 'missing', bin });
  if (healthCache.value && Date.now() - healthCache.at < HEALTH_TTL) return cb(healthCache.value);

  // Кеш протух. Без объединения два параллельных GET /health, пришедших
  // между истечением кеша и записью нового значения, оба увидят "кеша нет"
  // и оба запустят настоящий вызов claude — задвоив трату лимита подписки
  // ровно в том сценарии, от которого кеш должен защищать. Поэтому первый
  // запрос запускает реальный вызов, а все, что пришли, пока он не завершён,
  // просто подписываются на его результат вместо того, чтобы порождать
  // свой собственный.
  if (healthInFlight) { healthInFlight.push(cb); return; }
  healthInFlight = [cb];

  runClaude({ system: '', prompt: 'Ответь одним словом: ок' }, 30000, (err) => {
    const value = err ? { status: 'stale', bin, reason: err.message.slice(0, 200) } : { status: 'ok', bin };
    healthCache = { at: Date.now(), value };
    const waiters = healthInFlight;
    healthInFlight = null;
    waiters.forEach((waiter) => waiter(value));
  });
}

const server = http.createServer((req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.method === 'GET' && req.url === '/health') {
    return checkHealth((v) => send(v.status === 'ok' ? 200 : 503, v));
  }
  if (req.method !== 'POST' || req.url !== '/generate') return send(404, { error: 'нет такого адреса' });
  if (TOKEN && req.headers['x-bridge-token'] !== TOKEN) return send(401, { error: 'неверный секрет' });

  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 4_000_000) req.destroy();
  });
  req.on('end', () => {
    let payload;
    try { payload = JSON.parse(body || '{}'); } catch { return send(400, { error: 'тело не разобрано как JSON' }); }

    let responded = false; // ответ уже отправлен клиенту
    let aborted = false;   // клиент оборвал соединение раньше, чем мы ответили
    let child = null;      // текущий порождённый процесс claude (если уже запущен)

    // Если сайт оборвал соединение (например, по собственному таймауту), а
    // ответ ещё не ушёл — порождённый claude без этого обработчика молотит
    // до TIMEOUT (по умолчанию 180с), удерживая слот ограничителя и тратя
    // лимит подписки на результат, который никому уже не нужен. При
    // maxConcurrent=2 несколько таких обрывов подряд забивают очередь живым
    // запросам на минуты — ровно то, от чего ограничитель должен защищать.
    // 'close' у res срабатывает и в штатном случае — после res.end(), — но
    // тогда responded уже true, и мы ничего не делаем: убивать нечего.
    res.on('close', () => {
      if (responded) return;
      aborted = true;
      if (child) child.kill('SIGTERM');
    });

    limiter.run(() => new Promise((resolve, reject) => {
      // Соединение уже оборвано, пока запрос ждал своей очереди в
      // ограничителе, — процесс ещё не порождён, и порождать его сейчас
      // означало бы тратить лимит подписки и слот на заведомо ненужный
      // результат.
      if (aborted) return reject(Object.assign(new Error('клиент отключился до запуска'), { code: 'ABORTED' }));
      child = runClaude(payload, TIMEOUT, (err, out) => (err ? reject(err) : resolve(out)));
    })).then(
      (out) => { responded = true; markAlive(); send(200, out); },
      (err) => { responded = true; if (!aborted) send(err.code === 'BUSY' ? 503 : 502, { error: err.message }); },
    );
  });
});

server.listen(PORT, HOST, () =>
  console.log(`мост к подписке Claude слушает ${HOST}:${PORT}`));
