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
}

// --- проверка живости ---
// Смотреть только наличие бинаря нельзя: протухшая авторизация выглядит как
// здоровый сервис. Поэтому делаем настоящий короткий запрос — но ТОЛЬКО по
// запросу и с кешем, потому что каждый такой вызов тратит лимит подписки.
// Никаких таймеров и внешних опросов заводить нельзя.
let healthCache = { at: 0, value: null };

function markAlive() {
  healthCache = { at: Date.now(), value: { status: 'ok', bin: resolveClaudeBin() } };
}

function checkHealth(cb) {
  const bin = resolveClaudeBin();
  if (bin !== 'claude' && !existsSync(bin)) return cb({ status: 'missing', bin });
  if (healthCache.value && Date.now() - healthCache.at < HEALTH_TTL) return cb(healthCache.value);

  runClaude({ system: '', prompt: 'Ответь одним словом: ок' }, 30000, (err) => {
    const value = err ? { status: 'stale', bin, reason: err.message.slice(0, 200) } : { status: 'ok', bin };
    healthCache = { at: Date.now(), value };
    cb(value);
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

    limiter.run(() => new Promise((resolve, reject) => {
      runClaude(payload, TIMEOUT, (err, out) => (err ? reject(err) : resolve(out)));
    })).then(
      (out) => { markAlive(); send(200, out); },
      (err) => send(err.code === 'BUSY' ? 503 : 502, { error: err.message }),
    );
  });
});

server.listen(PORT, HOST, () =>
  console.log(`мост к подписке Claude слушает ${HOST}:${PORT}`));
