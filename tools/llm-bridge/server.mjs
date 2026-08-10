// Мост «подписка Claude → сайт». Крошечный сервис НА ХОСТЕ, оборачивает
// `claude -p` (headless, авторизация из ~/.claude). Без зависимостей.
//
// Запуск: BRIDGE_TOKEN=... node server.mjs
import http from 'node:http';
import { execFile } from 'node:child_process';
import { readdirSync, existsSync, statSync } from 'node:fs';
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

// Потолок ожидания ОДНОГО вызова claude. Осознанно меньше, чем таймаут
// клиента (CLAUDE_BRIDGE_TIMEOUT_MS, 110с) и тем более nginx (180с): бюджеты
// вложены друг в друга, чтобы мост успел вернуть честный 502 РАНЬШЕ, чем
// клиент оборвёт запрос. Раньше все три бюджета были равны 180с, и протухшая
// сессия выглядела так: посетитель три минуты смотрит в пустоту, nginx отдаёт
// 504 ровно в тот момент, когда код только собрался пойти на запасной ключ, —
// то есть запасной поставщик не срабатывал ни разу.
//
// Само значение измерено, а не выдумано: боевая карточка (5118 токенов
// вывода) на claude-sonnet-5 на этой машине заняла 77с. 100с — это запас
// около трети сверху. Ставить меньше нельзя: при 60с честная генерация
// обрывалась на 62-й секунде и уходила на платный ключ каждый раз.
const TIMEOUT = Number(process.env.BRIDGE_TIMEOUT_MS || 100000);
const HEALTH_TTL = Number(process.env.BRIDGE_HEALTH_TTL_MS || 60000);
// Проверка живости — заведомо короткий запрос, ей полный бюджет не нужен.
const HEALTH_TIMEOUT = Number(process.env.BRIDGE_HEALTH_TIMEOUT_MS || 30000);
// Сколько ждём после SIGTERM, прежде чем добить SIGKILL. Без эскалации
// зависший claude (например, залипший на сетевом вводе-выводе) игнорирует
// SIGTERM и держит слот ограничителя и память до бесконечности.
const KILL_GRACE_MS = 5000;
// Потолок буфера вывода. Ответ — карточка на несколько килобайт; 32 МБ на
// процесс при maxConcurrent=2 на машине с ~476 МБ свободных — это заявка на
// повторение падения по памяти.
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
// Потолок тела запроса В БАЙТАХ (а не в символах: кириллица в utf-8 — два
// байта на символ, и лимит по .length пропускал бы вдвое больше данных).
const MAX_BODY_BYTES = 4_000_000;
// Подписка по умолчанию отдаёт Opus 4.8 с окном в миллион токенов — для
// карточки это избыточно, а лимит Max он ест соответственно. Sonnet измерен
// на этой же машине и справляется. Образец в projectlevin модель не
// пробрасывает вообще, из-за чего всё идёт на самой тяжёлой.
const MODEL = process.env.BRIDGE_MODEL || 'claude-sonnet-5';

const limiter = createLimiter({
  maxConcurrent: Number(process.env.BRIDGE_MAX_CONCURRENT || 2),
  queueMax: Number(process.env.BRIDGE_QUEUE_MAX || 4),
});

// Исключение в обработчике http (или отклонённое обещание без .catch) роняет
// весь процесс — а вместе с ним и все параллельные запросы, которые к делу
// отношения не имели. Для моста, который обслуживает живых посетителей,
// «упасть целиком из-за одного кривого запроса» — недопустимый исход:
// systemd поднимет за пару секунд, но все, кто ждал ответа, получат обрыв.
// Логируем и продолжаем работать.
process.on('uncaughtException', (err) => {
  console.error('необработанное исключение (мост продолжает работу):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('необработанное отклонение обещания (мост продолжает работу):', reason);
});

// Бинарь резолвим на каждый вызов: расширение VS Code обновляется и удаляет
// старый путь. Это readdir одного каталога — при нашем трафике копейки.
//
// Версии сравниваем ПОЧИСЛЕННО. Лексикографическая сортировка ставила
// "anthropic.claude-code-2.1.99" выше "anthropic.claude-code-2.1.226"
// (символ '9' больше '2'), то есть после обновления мост продолжал бы
// запускать старую версию — вплоть до давно удалённых флагов и молчаливой
// деградации качества.
function compareVersionsDesc(a, b) {
  const pa = a.split('.').map((n) => Number(n) || 0);
  const pb = b.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d) return d;
  }
  return 0;
}

function resolveClaudeBin() {
  if (process.env.CLAUDE_BIN && existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
  const base = `${process.env.HOME || '/root'}/.vscode-server/extensions`;
  const PREFIX = 'anthropic.claude-code-';
  try {
    const dirs = readdirSync(base)
      .filter((d) => d.startsWith(PREFIX))
      // "anthropic.claude-code-2.1.226-linux-x64" → "2.1.226"
      .map((d) => ({ dir: d, ver: d.slice(PREFIX.length).split('-')[0] }))
      .sort((x, y) => compareVersionsDesc(x.ver, y.ver));
    for (const { dir } of dirs) {
      const p = `${base}/${dir}/resources/native-binary/claude`;
      if (existsSync(p)) return p;
    }
  } catch { /* каталога нет — идём на PATH */ }
  return 'claude';
}

// Рабочий каталог дочернего claude. Юнит задаёт WorkingDirectory, но мост
// умеют запускать и руками — тогда каталогом окажется что попало. Пустой
// каталог без ничего ценного — это второй рубеж на случай, если инструменты
// когда-нибудь снова окажутся включены по недосмотру.
function resolveWorkDir() {
  const dir = process.env.BRIDGE_WORKDIR;
  if (!dir) return undefined;
  try { return statSync(dir).isDirectory() ? dir : undefined; } catch { return undefined; }
}

// Мягко, потом жёстко: SIGTERM, и если процесс за KILL_GRACE_MS не умер —
// SIGKILL. Без второго шага зависший claude держит слот ограничителя, память
// и лимит подписки до конца времён.
function killChild(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  try { child.kill('SIGTERM'); } catch { /* уже мёртв */ }
  const hard = setTimeout(() => {
    try { child.kill('SIGKILL'); } catch { /* уже мёртв */ }
  }, KILL_GRACE_MS);
  hard.unref();
  child.once('exit', () => clearTimeout(hard));
}

// Какую модель на самом деле отработали. Брать первый ключ modelUsage нельзя:
// CLI подмешивает служебные вызовы к haiku, и в объекте она регулярно идёт
// ПЕРВОЙ — сайт записал бы в статистику "claude-haiku-4-5" вместо реальной
// модели карточки. Поэтому сначала ищем ту, что мы заказывали, а если её нет
// — берём самую «тяжёлую» по токенам.
function pickModel(modelUsage) {
  const entries = Object.entries(modelUsage || {});
  if (!entries.length) return '';
  const exact = entries.find(([name, u]) => name === MODEL || u?.canonicalModel === MODEL);
  if (exact) return exact[0];
  const weight = (u) => (u?.inputTokens || 0) + (u?.cacheCreationInputTokens || 0) +
    (u?.cacheReadInputTokens || 0) + (u?.outputTokens || 0);
  return entries.sort((a, b) => weight(b[1]) - weight(a[1]))[0][0];
}

function runClaude({ system, prompt }, timeoutMs, cb) {
  const bin = resolveClaudeBin();
  // Промпт через stdin, а не аргументом: текст, начинающийся с дефиса
  // (например markdown-разделитель), claude принимает за флаг и падает.
  // Плюс нет предела длины аргументов.
  //
  // --tools "" ОТКЛЮЧАЕТ инструменты. Здесь раньше стоял --allowedTools '',
  // и это была дыра: --allowedTools — список РАЗРЕШЕНИЙ, пустой список просто
  // ничего не добавляет к тому, что уже разрешено настройками владельца
  // (/root/.claude/settings.json: "Bash(*)", "Write", "Edit", "Agent").
  // Пользовательский промпт строится из данных посетителя — туда подставляется
  // имя Steam-профиля, — то есть текст злоумышленника доезжал до модели,
  // у которой Bash и Write работали без подтверждения, под root. Проверено
  // эмпирически: со старыми флагами модель прочитала файл с диска, с
  // --tools "" сессия стартует с tools=[] и ни одного tool_use.
  //
  // Остальное срезает обвязку, через которую в сессию попадали бы чужие
  // правила и чужой код:
  //   --setting-sources ""     — не читать settings.json (user/project/local)
  //   --strict-mcp-config      — игнорировать любые MCP-серверы, кроме...
  //   --mcp-config {}          — ...пустого набора, то есть никаких
  //   --disable-slash-commands — не подхватывать навыки владельца
  //   --no-session-persistence — не оседать сессией в /root/.claude/projects
  //                              и строкой в history.jsonl владельца: каждая
  //                              карточка посетителя иначе копится на диске
  //                              без всякого ограничения.
  //
  // ВАЖНО про порядок: --tools и --mcp-config вариадические (<tools...>),
  // они съедают все следующие аргументы до первого начинающегося с дефиса.
  // Поэтому сразу за их значениями обязан идти флаг, а не свободный текст.
  //
  // --bare сюда не годится, хотя и выглядит подходящим: он требует
  // ANTHROPIC_API_KEY и принципиально не читает авторизацию подписки —
  // то есть убивает саму идею моста.
  const args = [
    '-p',
    '--output-format', 'json',
    '--model', MODEL,
    '--tools', '',
    '--setting-sources', '',
    '--mcp-config', '{"mcpServers":{}}',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
  ];
  // --system-prompt ЗАМЕНЯЕТ системный промпт, --append-system-prompt (стоял
  // здесь раньше) ДОБАВЛЯЛ наш текст к полному системному промпту Claude Code.
  // Из-за этого каждый вызов тащил ~21 500 токенов чужого контекста: правила
  // работы с инструментами, стиль ответов, описание окружения. Нашему промпту
  // (lib/llm/prompt.ts, getSystemPrompt) внешние правила не нужны — он
  // самодостаточен и целиком описывает формат ответа.
  //
  // Системный промпт остаётся АРГУМЕНТОМ, а не stdin, и это безопасно:
  // stdin уже занят пользовательским промптом (одного stdin на двоих нет),
  // а обоснование про дефис к системному промпту не относится — это наша
  // собственная константа из репозитория, она начинается с «Ты — ...» и
  // данных посетителя не содержит. Опасен именно пользовательский текст,
  // и он идёт через stdin.
  if (system) args.push('--system-prompt', String(system));

  // Окружение дочернего процесса чистим до того состояния, в каком оно
  // оказалось бы при запуске из systemd — то есть без следов чужой сессии
  // и без наших секретов.
  const env = { ...process.env };
  // CLAUDECODE выставлен, если мост запущен из сессии Claude Code — вложенный
  // запуск такой сессии запрещён и падает с ошибкой. Заодно убираем всю
  // семью CLAUDE_CODE_*: при ручном запуске моста из сессии владельца туда
  // просачиваются CLAUDE_CODE_SESSION_ID, CLAUDE_CODE_CHILD_SESSION и прочее
  // (проверено по /proc/<pid>/environ дочернего процесса), и дочерний claude
  // начинает считать себя частью чужой сессии. В юните этих переменных нет
  // вовсе, так что чистка лишь уравнивает ручной запуск с боевым.
  delete env.CLAUDECODE;
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_CODE_')) delete env[k];
  // Дочернему процессу незачем знать секреты моста. Всё, что приходит из
  // EnvironmentFile, названо BRIDGE_* — включая BRIDGE_TOKEN, которым сайт
  // авторизуется. Модель с отключёнными инструментами их наружу не вынесет,
  // но и класть секрет в окружение процесса, которым управляет текст
  // посетителя, незачем: одна ошибка в флагах — и он утечёт в ответ.
  for (const k of Object.keys(env)) if (k.startsWith('BRIDGE_')) delete env[k];

  // Домашний каталог НЕ подменяем — дочерний claude читает /root/.claude
  // владельца напрямую. Отдельный дом требовал бы копии авторизации, а копия
  // протухает после каждого входа: мост молча начал бы отвечать «сессия
  // мертва», и это выглядело бы как необъяснимая поломка сайта.
  //
  // Плата за такое решение раньше была велика — вместе с авторизацией
  // подтягивались плагины, навыки и хуки владельца. Теперь их срезают
  // --setting-sources "" и --disable-slash-commands, так что из /root/.claude
  // берётся ровно одно: авторизация.
  const child = execFile(bin, args, {
    timeout: timeoutMs,
    maxBuffer: MAX_OUTPUT_BYTES,
    env,
    cwd: resolveWorkDir(),
  }, (err, stdout, stderr) => {
      clearTimeout(watchdog);
      if (!stdout) {
        // В err.message у execFile лежит ВСЯ командная строка — вместе с
        // системным промптом на 8 КБ и путём к бинарю. Раньше это целиком
        // уезжало в тело ответа: и мусор в логах сайта, и лишняя карта
        // устройства хоста для того, кто до моста дотянулся. Наружу — только
        // короткая причина, подробности пишем в журнал юнита.
        console.error('claude не ответил:', err?.message || '', String(stderr || '').slice(0, 500));
        const why = err?.killed ? `не уложился в ${Math.round(timeoutMs / 1000)}с`
          : err?.code ? `код выхода ${err.code}`
          : 'пустой вывод';
        return cb(new Error(`claude не ответил: ${why}`));
      }
      try {
        const j = JSON.parse(stdout);
        if (j.is_error) return cb(new Error(`claude вернул ошибку: ${j.subtype || ''} ${String(j.result || '').slice(0, 300)}`));
        cb(null, { text: String(j.result ?? ''), model: pickModel(j.modelUsage) });
      } catch (e) {
        cb(new Error('не разобрал ответ claude: ' + e.message));
      }
    });
  // execFile по таймауту шлёт SIGTERM и на этом останавливается. Если процесс
  // на SIGTERM не реагирует, он остаётся жить уже после того, как колбэк
  // отработал, — и продолжает есть память и лимит подписки. Сторож добивает.
  const watchdog = setTimeout(() => killChild(child), timeoutMs + KILL_GRACE_MS);
  watchdog.unref();
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
  healthCache = { at: Date.now(), value: { status: 'ok' } };
}

function checkHealth(cb) {
  const bin = resolveClaudeBin();
  // Путь к бинарю наружу НЕ отдаём: /health доступен всем контейнерам сети,
  // включая соседний проект, а раскладка файловой системы хоста — лишняя
  // подсказка тому, кто уже оказался внутри сети.
  if (bin !== 'claude' && !existsSync(bin)) return cb({ status: 'missing' });
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

  const finish = (value) => {
    const waiters = healthInFlight;
    healthInFlight = null;
    waiters.forEach((waiter) => waiter(value));
  };

  // Проверка живости идёт ЧЕРЕЗ ограничитель. Раньше она шла мимо, и при двух
  // занятых слотах в системе оказывалось три процесса claude — ровно на один
  // больше потолка, который ограничитель обязан держать. На машине с ~476 МБ
  // свободной памяти это разница между «медленно» и «OOM».
  limiter.run(() => new Promise((resolve, reject) => {
    runClaude({ system: '', prompt: 'Ответь одним словом: ок' }, HEALTH_TIMEOUT,
      (err) => (err ? reject(err) : resolve()));
  })).then(
    () => { healthCache = { at: Date.now(), value: { status: 'ok' } }; finish(healthCache.value); },
    (err) => {
      // Занятый мост — это живой мост. Кешировать по нему "stale" на минуту
      // значило бы объявить рабочий мост мёртвым из-за наплыва.
      if (err.code === 'BUSY') return finish({ status: 'busy' });
      // Текст ошибки — в лог владельцу, а не в ответ: там путь к бинарю,
      // куски stderr и прочие подробности устройства хоста.
      console.error('проверка живости не прошла:', err.message);
      healthCache = { at: Date.now(), value: { status: 'stale' } };
      finish(healthCache.value);
    },
  );
}

const server = http.createServer((req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  // Секрет проверяем ДО разбора адреса. Раньше ветка /health стояла выше
  // проверки, и любой контейнер, дотянувшийся до 172.19.0.1:8788 (в этой сети
  // живёт в том числе nginx соседнего проекта), мог раз в минуту запускать
  // настоящий вызов claude и молча жечь лимит подписки — без секрета и без
  // единой записи о том, кто это делает.
  if (TOKEN && req.headers['x-bridge-token'] !== TOKEN) return send(401, { error: 'неверный секрет' });

  if (req.method === 'GET' && req.url === '/health') {
    return checkHealth((v) => send(v.status === 'ok' ? 200 : 503, v));
  }
  if (req.method !== 'POST' || req.url !== '/generate') return send(404, { error: 'нет такого адреса' });

  // Чанки копим массивом и декодируем ОДИН раз в конце. Раньше было
  // `body += c`, где c — Buffer: каждый чанк декодировался как utf-8
  // отдельно, и многобайтовый символ, попавший на границу чанков,
  // превращался в два U+FFFD. JSON при этом оставался валидным, ошибки не
  // возникало — промпт молча портился в случайном месте. На системном
  // промпте в 8 КБ кириллицы границы чанков неизбежны.
  const chunks = [];
  let bytes = 0;
  req.on('data', (c) => {
    chunks.push(c);
    // Лимит В БАЙТАХ: .length у строки считал символы, и кириллическое тело
    // проезжало вдвое больший объём, чем задумано.
    bytes += c.length;
    if (bytes > MAX_BODY_BYTES) req.destroy();
  });
  req.on('end', () => {
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
    catch { return send(400, { error: 'тело не разобрано как JSON' }); }

    let responded = false; // ответ уже отправлен клиенту
    let aborted = false;   // клиент оборвал соединение раньше, чем мы ответили
    let child = null;      // текущий порождённый процесс claude (если уже запущен)

    // Если сайт оборвал соединение (например, по собственному таймауту), а
    // ответ ещё не ушёл — порождённый claude без этого обработчика молотит
    // до TIMEOUT, удерживая слот ограничителя и тратя лимит подписки на
    // результат, который никому уже не нужен. При maxConcurrent=2 несколько
    // таких обрывов подряд забивают очередь живым запросам на минуты — ровно
    // то, от чего ограничитель должен защищать.
    // 'close' у res срабатывает и в штатном случае — после res.end(), — но
    // тогда responded уже true, и мы ничего не делаем: убивать нечего.
    res.on('close', () => {
      if (responded) return;
      aborted = true;
      killChild(child);
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

// Без этого обработчика неудачный listen (например, EADDRNOTAVAIL, если шлюз
// docker-сети определился неверно) роняет процесс необработанным исключением:
// юнит уходит в failed, а скрипт установки при этом рапортует «✓». Владелец
// видит зелёный вывод и мёртвый мост.
server.on('error', (err) => {
  if (err.code === 'EADDRNOTAVAIL') {
    console.error(
      `Не удалось занять адрес ${HOST}:${PORT} — такого адреса на этой машине нет. ` +
      'Обычно это значит, что BRIDGE_HOST указывает на шлюз несуществующей ' +
      'или пересозданной docker-сети. Проверь: docker network inspect <сеть> ' +
      'и перезапусти deploy/llm-bridge-setup.sh.',
    );
  } else if (err.code === 'EADDRINUSE') {
    console.error(
      `Адрес ${HOST}:${PORT} уже занят — вероятно, мост уже запущен. ` +
      'Проверь: systemctl status gamertype-llm-bridge.service',
    );
  } else {
    console.error(`Не удалось запустить мост на ${HOST}:${PORT}: ${err.message}`);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () =>
  console.log(`мост к подписке Claude слушает ${HOST}:${PORT}`));
