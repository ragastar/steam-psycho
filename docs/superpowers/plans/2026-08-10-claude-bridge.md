# Мост к подписке Claude — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести генерацию текстовой карточки с OpenRouter на подписку Claude Max через локальный мост, оставив оплачиваемый ключ Anthropic запасным.

**Architecture:** Крошечный сервис без зависимостей на хосте оборачивает `claude -p` и слушает шлюз docker-сети. Приложение в контейнере ходит на него по HTTP с общим секретом. Любой отказ моста — единый тип ошибки, по которому генерация уходит на оплачиваемый ключ.

**Tech Stack:** Node 20 (мост, без зависимостей), Next 16 + TypeScript (приложение), zod (проверка ответа), vitest (тесты), systemd (запуск моста).

**Спека:** `docs/superpowers/specs/2026-08-10-claude-bridge-design.md`

## Global Constraints

- Мост слушает **только шлюз docker-сети приложения**, никогда `0.0.0.0`.
- Сеть у steam-psycho своя: шлюз **172.19.0.1**, не `docker0` (172.17.0.1). Определять из сети контейнера, не хардкодить.
- Промпт передаётся `claude` **через stdin**, не аргументом: текст с дефиса в начале иначе принимается за флаг.
- Мост запускается с `--allowedTools ''` — только текст, никаких действий.
- Проверка живости **только по запросу, никогда по расписанию**: каждый вызов тратит лимит подписки.
- **Каждый вызов моста несёт ~33 000 токенов ввода собственного контекста Claude Code** — это до нашего промпта. Замер 2026-08-10 на Sonnet 5 с прогретым кешем. Основная масса — 29 определений инструментов: `--allowedTools ''` запрещает ими пользоваться, но описания всё равно уезжают в запрос. Плюс системный промпт, каталог 28 навыков и 43 команд, хук старта сессии (3 472 символа). Срезать нечем: с полностью чистым домашним каталогом выходит 31 185 против 33 562, то есть личная обвязка владельца — 7%, остальные 93% встроены.
- **Модель задаётся явно** (`--model claude-sonnet-5`). Подписка сама отдаёт Opus 4.8 с окном в миллион токенов — для карточки избыточно и быстро съедает лимит Max. Псевдонимом `sonnet` не пользуемся: он может поехать при смене поколения. Образец в projectlevin модель не пробрасывает вовсе; здесь это исправлено.
- Комментарии, коммиты и сообщения об ошибках — на русском (конвенция репозитория).
- В `GenerationResult.provider` пишется тот, кто **реально** отработал, — поле идёт в статистику.
- Ограничения доступа (`DISABLE_GATE`, потолок генераций) в этой работе **не трогаем** — решение владельца.
- Все команды выполняются из `/opt/steam-psycho`, ветка `fix/pre-launch-audit`.

## Структура файлов

**Создаются:**
- `lib/llm/json.ts` — извлечение JSON из текста ответа. Вынесено из `client.ts`, чтобы поставщик мог его импортировать без кольца зависимостей.
- `lib/llm/providers/claude-bridge.ts` — поставщик: запрос к мосту, разбор, переспрос, единый тип ошибки.
- `tools/llm-bridge/limiter.mjs` — ограничитель одновременных вызовов. Отдельный модуль, потому что это единственная часть моста, которую имеет смысл покрыть тестами.
- `tools/llm-bridge/server.mjs` — сам мост.
- `deploy/llm-bridge.service` — юнит systemd.
- `deploy/llm-bridge-setup.sh` — идемпотентная установка.
- `tests/bridge-limiter.test.ts`, `tests/claude-bridge.test.ts`, `tests/llm-fallback.test.ts`.

**Меняются:**
- `lib/llm/client.ts` — третий поставщик, переход на запасного.
- `docker-compose.yml` — `extra_hosts` для доступа к хосту.
- `.env.local.example` — новые настройки.

---

### Task 1: Ограничитель одновременных вызовов

Каждый вызов моста — отдельный процесс `claude`. На сервере два ядра и соседний проект, поэтому нужен потолок. Когда и потолок занят, и очередь полна, мост обязан **сразу** ответить «занят»: приложению лучше мгновенно уйти на запасной ключ, чем держать посетителя в неизвестности.

**Files:**
- Create: `tools/llm-bridge/limiter.mjs`
- Test: `tests/bridge-limiter.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `createLimiter({ maxConcurrent, queueMax })` → `{ run(fn): Promise<T>, stats(): { active: number, waiting: number } }`. При переполнении `run` отклоняется с `Error`, у которого `code === "BUSY"`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/bridge-limiter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createLimiter } from "../tools/llm-bridge/limiter.mjs";

/** Обещание, которое разрешают снаружи — так тест управляет «долгими» задачами. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("ограничитель одновременных вызовов моста", () => {
  it("больше maxConcurrent одновременно не запускает", async () => {
    const limiter = createLimiter({ maxConcurrent: 2, queueMax: 5 });
    const gates = [deferred(), deferred(), deferred()];
    let started = 0;

    gates.forEach((g) => limiter.run(() => { started++; return g.promise; }));
    await Promise.resolve();

    expect(started).toBe(2);
    expect(limiter.stats()).toEqual({ active: 2, waiting: 1 });
  });

  it("освободившийся слот забирает ожидающий", async () => {
    const limiter = createLimiter({ maxConcurrent: 1, queueMax: 5 });
    const first = deferred();
    let secondStarted = false;

    const a = limiter.run(() => first.promise);
    const b = limiter.run(() => { secondStarted = true; return Promise.resolve("готово"); });

    expect(secondStarted).toBe(false);
    first.resolve();
    await a;
    await expect(b).resolves.toBe("готово");
    expect(secondStarted).toBe(true);
  });

  it("при полной очереди отказывает сразу, а не копит ожидающих", async () => {
    const limiter = createLimiter({ maxConcurrent: 1, queueMax: 1 });
    const gate = deferred();

    limiter.run(() => gate.promise);
    limiter.run(() => gate.promise);
    const third = limiter.run(() => gate.promise);

    await expect(third).rejects.toMatchObject({ code: "BUSY" });
    gate.resolve();
  });

  it("падение задачи освобождает слот", async () => {
    const limiter = createLimiter({ maxConcurrent: 1, queueMax: 5 });

    await expect(limiter.run(() => Promise.reject(new Error("бум")))).rejects.toThrow("бум");
    await expect(limiter.run(() => Promise.resolve("ок"))).resolves.toBe("ок");
    expect(limiter.stats()).toEqual({ active: 0, waiting: 0 });
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

```bash
cd /opt/steam-psycho && npx vitest run tests/bridge-limiter.test.ts
```

Ожидается: FAIL, не удаётся разрешить `../tools/llm-bridge/limiter.mjs`.

- [ ] **Шаг 3: Написать ограничитель**

Создать `tools/llm-bridge/limiter.mjs`:

```js
/**
 * Ограничитель одновременных вызовов claude.
 *
 * Каждый вызов — отдельный процесс, а на сервере два ядра и соседний проект.
 * Без потолка первый же наплыв кладёт машину.
 *
 * Когда заняты и слоты, и очередь, отказываем СРАЗУ с code="BUSY": вызывающему
 * лучше мгновенно уйти на запасного поставщика, чем ждать неизвестно сколько.
 */
export function createLimiter({ maxConcurrent = 2, queueMax = 4 } = {}) {
  let active = 0;
  const waiting = [];

  function pump() {
    if (active >= maxConcurrent) return;
    const job = waiting.shift();
    if (!job) return;
    active++;
    // Promise.resolve().then(...) — чтобы синхронное исключение внутри задачи
    // тоже стало отклонённым обещанием, а не уронило ограничитель.
    Promise.resolve()
      .then(job.run)
      .then(job.resolve, job.reject)
      .finally(() => {
        active--;
        pump();
      });
  }

  return {
    run(fn) {
      if (active >= maxConcurrent && waiting.length >= queueMax) {
        const err = new Error("мост занят: и слоты, и очередь заполнены");
        err.code = "BUSY";
        return Promise.reject(err);
      }
      return new Promise((resolve, reject) => {
        waiting.push({ run: fn, resolve, reject });
        pump();
      });
    },
    stats() {
      return { active, waiting: waiting.length };
    },
  };
}
```

- [ ] **Шаг 4: Убедиться, что тест проходит**

```bash
cd /opt/steam-psycho && npx vitest run tests/bridge-limiter.test.ts
```

Ожидается: PASS, 4 теста.

- [ ] **Шаг 5: Коммит**

```bash
cd /opt/steam-psycho && git add tools/llm-bridge/limiter.mjs tests/bridge-limiter.test.ts && git commit -m "feat: ограничитель одновременных вызовов для моста

Каждый вызов claude — отдельный процесс, на сервере два ядра.
При полной очереди отказ отдаётся сразу, чтобы вызывающий ушёл
на запасного поставщика, а не висел.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Мост на хосте

**Files:**
- Create: `tools/llm-bridge/server.mjs`
- Test: проверяется вручную командами в шаге 4 (сеть и внешний процесс, автотестом не покрывается)

**Interfaces:**
- Consumes: `createLimiter` из Task 1.
- Produces: HTTP `POST /generate` с телом `{system, prompt}` и заголовком `x-bridge-token` → `{text, model}`; `GET /health` → `{status: "ok"|"stale"|"missing", bin}`. Отказы: 401 без секрета, 503 при `BUSY` и при мёртвой сессии, 502 при ошибке `claude`.

- [ ] **Шаг 1: Написать мост**

Создать `tools/llm-bridge/server.mjs`:

```js
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
```

- [ ] **Шаг 2: Проверить синтаксис**

```bash
cd /opt/steam-psycho && node --check tools/llm-bridge/server.mjs && echo "синтаксис в порядке"
```

Ожидается: `синтаксис в порядке`.

- [ ] **Шаг 3: Запустить вручную и проверить отказы**

Запустить мост в фоне на loopback:

```bash
cd /opt/steam-psycho && BRIDGE_TOKEN=проверка BRIDGE_PORT=8799 BRIDGE_HOST=127.0.0.1 node tools/llm-bridge/server.mjs &
```

- [ ] **Шаг 4: Проверить поведение без обращения к подписке**

```bash
curl -sS -o /dev/null -w "нет секрета -> %{http_code}\n" -X POST http://127.0.0.1:8799/generate -H 'content-type: application/json' -d '{"prompt":"привет"}'
curl -sS -o /dev/null -w "неизвестный адрес -> %{http_code}\n" http://127.0.0.1:8799/nope
curl -sS -o /dev/null -w "битое тело -> %{http_code}\n" -X POST http://127.0.0.1:8799/generate -H 'x-bridge-token: проверка' -d 'не json'
```

Ожидается: `401`, `404`, `400`. Затем остановить: `kill %1`.

Проверку `/health` и настоящую генерацию **не выполняем** — сессия подписки на сервере протухла (см. спеку), это Task 6.

- [ ] **Шаг 5: Коммит**

```bash
cd /opt/steam-psycho && git add tools/llm-bridge/server.mjs && git commit -m "feat: мост к подписке Claude на хосте

Оборачивает claude -p, слушает шлюз docker-сети, авторизация
по общему секрету. Проверка живости делает настоящий запрос
и кешируется: смотреть только наличие бинаря нельзя, протухшая
сессия выглядит как здоровый сервис.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Извлечение JSON отдельным модулем

Поставщику нужен разбор JSON из текста, но он лежит в `client.ts`, который сам импортирует поставщиков. Импорт обратно дал бы кольцо, поэтому выносим.

**Files:**
- Create: `lib/llm/json.ts`
- Modify: `lib/llm/client.ts` (убрать локальную `extractJSON`, импортировать из нового модуля)
- Test: `tests/llm-json.test.ts`

**Interfaces:**
- Produces: `extractJSON(text: string): unknown`. Бросает `Error` с текстом «В ответе модели нет JSON», если ничего не нашлось.

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/llm-json.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractJSON } from "@/lib/llm/json";

describe("извлечение JSON из ответа модели", () => {
  it("разбирает чистый JSON", () => {
    expect(extractJSON('{"a":1}')).toEqual({ a: 1 });
  });

  it("достаёт JSON из markdown-блока", () => {
    expect(extractJSON('Вот результат:\n```json\n{"a":1}\n```\nГотово')).toEqual({ a: 1 });
  });

  it("достаёт JSON из блока без пометки языка", () => {
    expect(extractJSON('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("достаёт JSON, окружённый болтовнёй", () => {
    expect(extractJSON('Конечно! {"a":1} — надеюсь, помог.')).toEqual({ a: 1 });
  });

  it("бросает понятную ошибку, когда JSON нет", () => {
    expect(() => extractJSON("извини, не могу")).toThrow(/нет JSON/);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

```bash
cd /opt/steam-psycho && npx vitest run tests/llm-json.test.ts
```

Ожидается: FAIL, не удаётся разрешить `@/lib/llm/json`.

- [ ] **Шаг 3: Создать модуль**

Создать `lib/llm/json.ts`:

```ts
/**
 * Извлечение JSON из ответа модели.
 *
 * Нужно всем поставщикам, кроме прямого API Anthropic: там формат задан схемой
 * и разбирать нечего. Отдельный модуль, потому что импортировать это из
 * client.ts в поставщика нельзя — client.ts сам импортирует поставщиков,
 * получилось бы кольцо.
 */
export function extractJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return JSON.parse(fenced[1].trim());
    const braces = text.match(/\{[\s\S]*\}/);
    if (braces) return JSON.parse(braces[0]);
    throw new Error("В ответе модели нет JSON");
  }
}
```

- [ ] **Шаг 4: Переключить client.ts на модуль**

В `lib/llm/client.ts` удалить весь блок:

```ts
// --- JSON extraction ---

function extractJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return JSON.parse(match[1].trim());
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    throw new Error("No valid JSON found in LLM response");
  }
}
```

и добавить к импортам сверху файла:

```ts
import { extractJSON } from "./json";
```

- [ ] **Шаг 5: Убедиться, что всё зелёное**

```bash
cd /opt/steam-psycho && npm run verify
```

Ожидается: типы чистые, 64 теста пройдено (55 до плана + 4 из Task 1 + 5 новых).

- [ ] **Шаг 6: Коммит**

```bash
cd /opt/steam-psycho && git add lib/llm/json.ts lib/llm/client.ts tests/llm-json.test.ts && git commit -m "refactor: извлечение JSON отдельным модулем

Поставщику моста нужен тот же разбор, но импортировать его из
client.ts нельзя — client.ts сам импортирует поставщиков.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Поставщик claude-bridge

Главная потеря по сравнению с прямым API: формат ответа схемой не гарантирован. Возвращаем разбор из текста, проверку зодом и один переспрос.

**Files:**
- Create: `lib/llm/providers/claude-bridge.ts`
- Test: `tests/claude-bridge.test.ts`

**Interfaces:**
- Consumes: `extractJSON` из Task 3, `CardPortraitSchema` из `lib/llm/types`.
- Produces: `generateWithBridge(systemPrompt: string, userPrompt: string): Promise<{ portrait: CardPortrait; model: string }>` и класс `BridgeUnavailableError`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/claude-bridge.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateWithBridge, BridgeUnavailableError } from "@/lib/llm/providers/claude-bridge";

/** Минимальная карточка, проходящая CardPortraitSchema. */
const VALID = {
  primaryArchetype: { name: "Затворник", description: "Играет один", color: "#fff" },
  secondaryArchetype: { name: "Скупщик", description: "Копит скидки", color: "#ccc" },
  shadowArchetype: { name: "Призрак", description: "Заходит раз в год", color: "#333" },
  stats: { dedication: 50, mastery: 40, exploration: 30, hoarding: 90, social: 10, veteran: 70 },
  roasts: Array.from({ length: 6 }, (_, i) => ({
    icon: "🔥", title: `Подкол ${i + 1}`, text: "Текст подкола",
    stat: "hoarding", severity: "epic" as const, source: "библиотека",
  })),
  quote: "Купил, но не сыграл",
  spirit_game: "Steam",
};

function reply(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  process.env.CLAUDE_BRIDGE_TOKEN = "секрет";
  process.env.CLAUDE_BRIDGE_ENDPOINT = "http://мост.local/generate";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CLAUDE_BRIDGE_TOKEN;
  delete process.env.CLAUDE_BRIDGE_ENDPOINT;
});

describe("поставщик через мост к подписке", () => {
  it("разбирает валидный ответ с первого раза", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({ text: JSON.stringify(VALID), model: "claude-opus-5" }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await generateWithBridge("система", "запрос");

    expect(out.portrait.primaryArchetype.name).toBe("Затворник");
    expect(out.model).toBe("claude-opus-5");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("достаёт карточку из markdown-блока", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      reply({ text: "Готово:\n```json\n" + JSON.stringify(VALID) + "\n```" }),
    ));

    const out = await generateWithBridge("система", "запрос");
    expect(out.portrait.quote).toBe("Купил, но не сыграл");
    expect(out.model).toBe("subscription");
  });

  it("переспрашивает один раз, если ответ не разобрался", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply({ text: "извини, не могу" }))
      .mockResolvedValueOnce(reply({ text: JSON.stringify(VALID) }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await generateWithBridge("система", "запрос");

    expect(out.portrait.stats.hoarding).toBe(90);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("сдаётся после второго промаха", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ text: "всё ещё не могу" })));
    await expect(generateWithBridge("система", "запрос")).rejects.toBeInstanceOf(BridgeUnavailableError);
  });

  it("занятый мост превращается в BridgeUnavailableError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ error: "мост занят" }, 503)));
    await expect(generateWithBridge("система", "запрос")).rejects.toThrow(/недоступен/);
  });

  it("без секрета в сеть не ходит", async () => {
    delete process.env.CLAUDE_BRIDGE_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateWithBridge("система", "запрос")).rejects.toThrow(/TOKEN/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("системный и пользовательский промпт идут в разные поля", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({ text: JSON.stringify(VALID) }));
    vi.stubGlobal("fetch", fetchMock);

    await generateWithBridge("СИСТЕМА", "ЗАПРОС");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ system: "СИСТЕМА", prompt: "ЗАПРОС" });
    expect(fetchMock.mock.calls[0][1].headers["x-bridge-token"]).toBe("секрет");
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

```bash
cd /opt/steam-psycho && npx vitest run tests/claude-bridge.test.ts
```

Ожидается: FAIL, не удаётся разрешить `@/lib/llm/providers/claude-bridge`.

- [ ] **Шаг 3: Написать поставщика**

Создать `lib/llm/providers/claude-bridge.ts`:

```ts
import { CardPortraitSchema } from "../types";
import type { CardPortrait } from "../types";
import { extractJSON } from "../json";

/**
 * Генерация карточки через мост к подписке Claude (tools/llm-bridge).
 *
 * В отличие от прямого API, формат ответа схемой НЕ гарантирован: мост отдаёт
 * голый текст. Поэтому вернулись разбор JSON из текста, проверка зодом и один
 * переспрос — та же механика, что на пути OpenRouter.
 */

const DEFAULT_ENDPOINT = "http://host.docker.internal:8788/generate";
const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * Единый тип отказа моста: нет ответа, таймаут, занято, мёртвая сессия,
 * неразбираемый ответ после переспроса. Вызывающий код по нему уходит на
 * запасного поставщика и не разбирает причины.
 */
export class BridgeUnavailableError extends Error {
  constructor(reason: string) {
    super(`Мост к подписке Claude недоступен: ${reason}`);
    this.name = "BridgeUnavailableError";
  }
}

export interface BridgeGeneration {
  portrait: CardPortrait;
  model: string;
}

interface BridgeReply {
  text?: string;
  model?: string;
  error?: string;
}

async function callBridge(system: string, prompt: string): Promise<BridgeReply> {
  const token = process.env.CLAUDE_BRIDGE_TOKEN?.trim();
  if (!token) throw new BridgeUnavailableError("CLAUDE_BRIDGE_TOKEN не задан");

  const endpoint = process.env.CLAUDE_BRIDGE_ENDPOINT?.trim() || DEFAULT_ENDPOINT;
  const timeout = Number(process.env.CLAUDE_BRIDGE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-token": token },
      body: JSON.stringify({ system, prompt }),
      signal: ctrl.signal,
    });
  } catch (e) {
    const err = e as Error;
    throw new BridgeUnavailableError(
      err.name === "AbortError" ? `таймаут ${Math.round(timeout / 1000)}с` : err.message,
    );
  } finally {
    clearTimeout(timer);
  }

  const data = (await res.json().catch(() => ({}))) as BridgeReply;
  if (!res.ok) throw new BridgeUnavailableError(data.error || `HTTP ${res.status}`);
  if (data.error) throw new BridgeUnavailableError(data.error);
  if (!data.text) throw new BridgeUnavailableError("пустой ответ");
  return data;
}

function parsePortrait(text: string): CardPortrait | null {
  try {
    return CardPortraitSchema.parse(extractJSON(text));
  } catch {
    return null;
  }
}

export async function generateWithBridge(
  systemPrompt: string,
  userPrompt: string,
): Promise<BridgeGeneration> {
  const first = await callBridge(systemPrompt, userPrompt);
  const parsed = parsePortrait(first.text!);
  if (parsed) return { portrait: parsed, model: first.model || "subscription" };

  const retryPrompt =
    `${userPrompt}\n\nПредыдущий ответ не удалось разобрать. Верни ТОЛЬКО валидный ` +
    `JSON нужной структуры: без пояснений, без markdown-блока, без текста вокруг.`;

  const second = await callBridge(systemPrompt, retryPrompt);
  const retried = parsePortrait(second.text!);
  if (retried) return { portrait: retried, model: second.model || "subscription" };

  throw new BridgeUnavailableError("модель дважды вернула неразбираемый ответ");
}
```

- [ ] **Шаг 4: Убедиться, что тест проходит**

```bash
cd /opt/steam-psycho && npx vitest run tests/claude-bridge.test.ts
```

Ожидается: PASS, 7 тестов.

- [ ] **Шаг 5: Коммит**

```bash
cd /opt/steam-psycho && git add lib/llm/providers/claude-bridge.ts tests/claude-bridge.test.ts && git commit -m "feat: поставщик карточки через мост к подписке

Формат ответа схемой не гарантирован, поэтому разбор JSON из
текста, проверка зодом и один переспрос. Любой отказ моста —
один тип ошибки, по которому вызывающий уходит на запасного.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Переключение и переход на запасного

**Files:**
- Modify: `lib/llm/client.ts`
- Test: `tests/llm-fallback.test.ts`

**Interfaces:**
- Consumes: `generateWithBridge`, `BridgeUnavailableError` из Task 4.
- Produces: `LLMProvider` получает значение `"claude-bridge"`; `generatePortrait` при отказе моста возвращает результат запасного, а `GenerationResult.provider` равен фактическому.

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/llm-fallback.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const bridgeMock = vi.hoisted(() => vi.fn());
const anthropicMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/llm/providers/claude-bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/providers/claude-bridge")>();
  return { ...actual, generateWithBridge: bridgeMock };
});

vi.mock("@/lib/llm/providers/anthropic", () => ({
  generateWithAnthropic: anthropicMock,
  PortraitRefusedError: class extends Error {},
}));

// Сборка промптов лезет глубоко в профиль, а здесь проверяется только выбор
// поставщика — настоящий профиль ради этого собирать незачем.
vi.mock("@/lib/llm/prompt", () => ({
  getSystemPrompt: () => "системный промпт",
  buildUserPrompt: () => "пользовательский промпт",
}));

import { generatePortrait, resolveConfig } from "@/lib/llm/client";
import { BridgeUnavailableError } from "@/lib/llm/providers/claude-bridge";
import type { AggregatedProfile } from "@/lib/aggregation/types";
import type { CardStats } from "@/lib/aggregation/aggregate";

const ENV_KEYS = ["LLM_PROVIDER", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_BRIDGE_TOKEN"];
const profile = {} as AggregatedProfile;
const cardStats = {} as CardStats;
const portrait = { quote: "заглушка" } as never;

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  bridgeMock.mockReset();
  anthropicMock.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe("мост как основной поставщик", () => {
  it("claude-bridge — допустимое значение настройки", () => {
    process.env.LLM_PROVIDER = "claude-bridge";
    expect(resolveConfig().provider).toBe("claude-bridge");
  });

  it("не требует ключей: у моста своя авторизация", () => {
    process.env.LLM_PROVIDER = "claude-bridge";
    expect(() => resolveConfig()).not.toThrow();
  });

  it("успешный мост отдаёт карточку и себя как поставщика", async () => {
    process.env.LLM_PROVIDER = "claude-bridge";
    bridgeMock.mockResolvedValue({ portrait, model: "claude-opus-5" });

    const out = await generatePortrait(profile, cardStats, "rare", "ru");

    expect(out.provider).toBe("claude-bridge");
    expect(out.model).toBe("claude-opus-5");
    expect(anthropicMock).not.toHaveBeenCalled();
  });

  it("отказ моста уводит на оплачиваемый ключ, и это видно в результате", async () => {
    process.env.LLM_PROVIDER = "claude-bridge";
    process.env.ANTHROPIC_API_KEY = "ключ";
    bridgeMock.mockRejectedValue(new BridgeUnavailableError("мост занят"));
    anthropicMock.mockResolvedValue({
      portrait, model: "claude-opus-5", inputTokens: 10, outputTokens: 20, cachedInputTokens: 0,
    });

    const out = await generatePortrait(profile, cardStats, "rare", "ru");

    expect(out.provider).toBe("anthropic");
    expect(anthropicMock).toHaveBeenCalledOnce();
  });

  it("без запасных ключей отказ моста доходит до вызывающего", async () => {
    process.env.LLM_PROVIDER = "claude-bridge";
    bridgeMock.mockRejectedValue(new BridgeUnavailableError("сессия протухла"));

    await expect(generatePortrait(profile, cardStats, "rare", "ru"))
      .rejects.toBeInstanceOf(BridgeUnavailableError);
  });

  it("ошибка не от моста не подменяется запасным — падаем честно", async () => {
    process.env.LLM_PROVIDER = "claude-bridge";
    process.env.ANTHROPIC_API_KEY = "ключ";
    bridgeMock.mockRejectedValue(new Error("ошибка в коде"));

    await expect(generatePortrait(profile, cardStats, "rare", "ru")).rejects.toThrow("ошибка в коде");
    expect(anthropicMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

```bash
cd /opt/steam-psycho && npx vitest run tests/llm-fallback.test.ts
```

Ожидается: FAIL — `resolveConfig` считает `claude-bridge` неизвестным поставщиком.

- [ ] **Шаг 3: Добавить третьего поставщика в client.ts**

В `lib/llm/client.ts` заменить объявления сверху:

```ts
export type LLMProvider = "claude-bridge" | "anthropic" | "openai";

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  // Модель определяет подписка, своего значения у моста нет.
  "claude-bridge": "subscription",
  // Должно совпадать с DEFAULT_MODEL в providers/anthropic.ts,
  // иначе статистика и админка покажут не ту модель, что отработала.
  anthropic: "claude-opus-5",
  openai: "openai/gpt-4o-mini",
};

const PROVIDERS: LLMProvider[] = ["claude-bridge", "anthropic", "openai"];
```

Добавить импорт рядом с импортом поставщика Anthropic:

```ts
import { generateWithBridge, BridgeUnavailableError } from "./providers/claude-bridge";
```

В `resolveConfig` заменить вычисление модели:

```ts
  const model =
    resolved === "openai"
      ? process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODELS.openai
      : resolved === "anthropic"
        ? process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODELS.anthropic
        : DEFAULT_MODELS["claude-bridge"];
```

- [ ] **Шаг 4: Добавить переход на запасного**

В `lib/llm/client.ts` перед `generatePortrait` добавить:

```ts
/**
 * Кого пробовать, когда мост отказал. Порядок: сначала оплачиваемый ключ
 * Anthropic (та же модель, гарантированный формат), потом OpenRouter.
 */
function pickFallback(): LLMProvider | null {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  return null;
}
```

И в начало тела `generatePortrait`, сразу после `const model = config.model!;`:

```ts
  if (config.provider === "claude-bridge") {
    try {
      const result = await generateWithBridge(
        getSystemPrompt(locale),
        buildUserPrompt(profile, cardStats, rarity),
      );
      return { portrait: result.portrait, provider: "claude-bridge", model: result.model };
    } catch (err) {
      // Подменяем запасным только отказ моста. Ошибка в нашем коде должна
      // падать честно, иначе она молча спрячется за счётом за токены.
      if (!(err instanceof BridgeUnavailableError)) throw err;

      const fallback = pickFallback();
      console.warn(`[llm] ${err.message}; ухожу на ${fallback ?? "никого — запасных ключей нет"}`);
      if (!fallback) throw err;

      return generatePortrait(profile, cardStats, rarity, locale, fallback);
    }
  }
```

- [ ] **Шаг 5: Показать моста в списке поставщиков**

В `getAvailableProviders` добавить первым элементом массива:

```ts
    {
      id: "claude-bridge",
      name: "Claude (подписка через мост)",
      model: DEFAULT_MODELS["claude-bridge"],
      available: !!process.env.CLAUDE_BRIDGE_TOKEN,
    },
```

- [ ] **Шаг 6: Убедиться, что всё зелёное**

```bash
cd /opt/steam-psycho && npm run verify
```

Ожидается: типы чистые, 77 тестов пройдено (64 после Task 3 + 7 из Task 4 + 6 новых).

- [ ] **Шаг 7: Коммит**

```bash
cd /opt/steam-psycho && git add lib/llm/client.ts tests/llm-fallback.test.ts && git commit -m "feat: мост основной поставщик, оплачиваемый ключ запасной

Отказ моста уводит генерацию на ключ Anthropic, а не роняет сайт.
В статистику пишется тот, кто реально отработал. Ошибка не от
моста запасным не подменяется — иначе спрячется за счётом.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Установка на сервере

**Files:**
- Create: `deploy/llm-bridge.service`, `deploy/llm-bridge-setup.sh`
- Modify: `docker-compose.yml`, `.env.local.example`

**Interfaces:**
- Consumes: `tools/llm-bridge/server.mjs` из Task 2.
- Produces: работающий `llm-bridge.service`; переменные `CLAUDE_BRIDGE_ENDPOINT` и `CLAUDE_BRIDGE_TOKEN` в `.env.local`.

- [x] **Шаг 0: Отдельный дом для дочернего процесса — РАССМОТРЕН И ОТВЕРГНУТ 2026-08-10**

Идея была: выдать `claude` внутри моста свой домашний каталог, чтобы он не подхватывал плагины, навыки и хук старта сессии владельца. Хук подмешивает в каждую генерацию текст про суперспособности — для карточки это шум.

Отвергнуто владельцем. Отдельный дом требует доставить туда авторизацию, а любой способ это сделать плох: копия протухает после каждого входа (мост молча ответит «сессия мертва», сайт молча уедет на платный ключ — выглядит как необъяснимая поломка), ссылку затирает сам `claude` при обновлении токена. Второй экземпляр долгоживущего токена на диске при этом ничего не даёт: мост и так работает под root, где лежит оригинал.

Решение: `HOME=/root` и для моста, и для дочернего процесса, авторизация читается на месте и никуда не копируется. Плата — шум от хука в промпте. Если качество текста однажды просядет без видимой причины, проверять надо здесь.

- [ ] **Шаг 1: Написать юнит systemd**

Создать `deploy/llm-bridge.service`:

```ini
[Unit]
Description=GamerType — мост к подписке Claude (обёртка над claude -p)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
# Под root: бинарь и авторизация подписки лежат в /root/.claude
# и /root/.vscode-server.
User=root
Environment=HOME=/root
# Секрет, адрес и потолки — в файле вне репозитория.
EnvironmentFile=/etc/gamertype-llm-bridge.env
# HOME=/root и для моста, и для дочернего claude: там и бинари расширений
# VS Code, и живая авторизация подписки. Отдельный дом для дочернего процесса
# рассматривался и отвергнут — он требовал копии авторизации, а копия
# протухает после каждого входа.
ExecStart=/usr/bin/node /opt/steam-psycho/tools/llm-bridge/server.mjs
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

- [ ] **Шаг 2: Написать скрипт установки**

Создать `deploy/llm-bridge-setup.sh`:

```bash
#!/usr/bin/env bash
# Идемпотентная установка моста к подписке Claude (tools/llm-bridge/server.mjs).
# Запуск: sudo bash deploy/llm-bridge-setup.sh
set -euo pipefail

REPO="${REPO:-/opt/steam-psycho}"
ENV_FILE="/etc/gamertype-llm-bridge.env"
PROJ_ENV="$REPO/.env.local"
PORT="${BRIDGE_PORT:-8788}"
CONTAINER="${CONTAINER:-steam-psycho-app-1}"

# Шлюз берём из сети САМОГО контейнера. У steam-psycho она своя (172.19.0.1);
# docker0 (172.17.0.1), на который смотрит аналогичный скрипт в projectlevin,
# здесь не подходит — контейнер моста на нём не увидит.
NET="$(docker inspect "$CONTAINER" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null || true)"
HOST_IP=""
if [ -n "$NET" ]; then
  HOST_IP="$(docker network inspect "$NET" --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null || true)"
fi
if [ -z "$HOST_IP" ]; then
  echo "Не удалось определить шлюз сети контейнера $CONTAINER." >&2
  echo "Запусти контейнер или задай BRIDGE_HOST вручную." >&2
  exit 1
fi

# Секрет переиспользуем, чтобы перезапуск установки не разлогинил приложение.
if [ -f "$ENV_FILE" ] && grep -q '^BRIDGE_TOKEN=' "$ENV_FILE"; then
  TOKEN="$(grep '^BRIDGE_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
else
  TOKEN="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
fi

umask 077
cat > "$ENV_FILE" <<EOF
BRIDGE_HOST=$HOST_IP
BRIDGE_PORT=$PORT
BRIDGE_TOKEN=$TOKEN
BRIDGE_MAX_CONCURRENT=${BRIDGE_MAX_CONCURRENT:-2}
BRIDGE_QUEUE_MAX=${BRIDGE_QUEUE_MAX:-4}
BRIDGE_TIMEOUT_MS=${BRIDGE_TIMEOUT_MS:-180000}
BRIDGE_HEALTH_TTL_MS=${BRIDGE_HEALTH_TTL_MS:-60000}
BRIDGE_MODEL=${BRIDGE_MODEL:-claude-sonnet-5}
EOF
echo "✓ $ENV_FILE (шлюз $HOST_IP, порт $PORT)"

# Настройки приложения. LLM_PROVIDER скрипт НЕ трогает — переключение
# на мост делается отдельно и осознанно.
touch "$PROJ_ENV"
sed -i '/^CLAUDE_BRIDGE_ENDPOINT=/d;/^CLAUDE_BRIDGE_TOKEN=/d' "$PROJ_ENV"
{
  echo "CLAUDE_BRIDGE_ENDPOINT=http://host.docker.internal:$PORT/generate"
  echo "CLAUDE_BRIDGE_TOKEN=$TOKEN"
} >> "$PROJ_ENV"
echo "✓ $PROJ_ENV"

install -m 644 "$REPO/deploy/llm-bridge.service" /etc/systemd/system/gamertype-llm-bridge.service
systemctl daemon-reload
systemctl enable --now gamertype-llm-bridge.service
systemctl restart gamertype-llm-bridge.service
sleep 1

echo "--- статус ---"
systemctl --no-pager --lines=5 status gamertype-llm-bridge.service || true
echo
echo "Дальше:"
echo "  1) проверить живость:  curl -sS http://$HOST_IP:$PORT/health"
echo "     status=stale означает, что нужен вход: claude login"
echo "  2) включить мост:      LLM_PROVIDER=claude-bridge в $PROJ_ENV"
echo "  3) применить:          docker compose up -d --build app"
```

- [ ] **Шаг 3: Дать контейнеру дорогу к хосту**

В `docker-compose.yml` в блок `app:` добавить после `dns:`:

```yaml
    # Доступ к мосту подписки Claude на хосте (tools/llm-bridge):
    # host.docker.internal резолвится в шлюз сети этого контейнера.
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

- [ ] **Шаг 4: Описать настройки в примере**

В `.env.local.example` добавить перед разделом «КАРТИНКИ (Wiro.ai)»:

```
# ─── МОСТ К ПОДПИСКЕ CLAUDE (LLM_PROVIDER=claude-bridge) ───

# Генерация идёт через подписку Claude Max вместо оплаты за токены.
# Мост живёт на ХОСТЕ (не в контейнере), ставится deploy/llm-bridge-setup.sh —
# он же заполняет обе переменные ниже. Руками их править не нужно.
#
# Когда мост недоступен (не отвечает, занят, сессия протухла), генерация
# автоматически уходит на ANTHROPIC_API_KEY, а если его нет — на OpenRouter.
CLAUDE_BRIDGE_ENDPOINT=
CLAUDE_BRIDGE_TOKEN=

# Потолок ожидания одного вызова. Холодный старт claude плюс генерация —
# это десятки секунд, поэтому значение большое.
CLAUDE_BRIDGE_TIMEOUT_MS=180000
```

- [ ] **Шаг 5: Проверить синтаксис скрипта и сборку compose**

```bash
cd /opt/steam-psycho && bash -n deploy/llm-bridge-setup.sh && docker compose config >/dev/null && echo "скрипт и compose разобраны"
```

Ожидается: `скрипт и compose разобраны`.

- [ ] **Шаг 6: Убедиться, что тесты не сломались**

```bash
cd /opt/steam-psycho && npm run verify
```

Ожидается: типы чистые, 77 тестов пройдено.

- [ ] **Шаг 7: Коммит**

```bash
cd /opt/steam-psycho && git add deploy/llm-bridge.service deploy/llm-bridge-setup.sh docker-compose.yml .env.local.example && git commit -m "feat: установка моста на сервере

Юнит systemd плюс идемпотентный скрипт. Шлюз берётся из сети
самого контейнера: у steam-psycho она своя, docker0 не подходит.
LLM_PROVIDER скрипт не трогает — переключение осознанное.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Запуск на проде

Единственная задача, где нужен живой человек: вход в подписку интерактивный.

**Files:** изменений в репозитории нет.

- [x] **Шаг 1: Восстановить сессию подписки — СДЕЛАНО 2026-08-10**

Вход выполнен владельцем через `/login` (со слэшем: без него текст уходит агенту как задача и возвращает 401). Проверено:

```bash
env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT bash -c "echo 'Ответь одним словом: ок' | claude -p --output-format json --allowedTools ''"
```

Ответ за 1,8 с, модель `claude-opus-4-8[1m]` (поэтому в мосте задан `--model sonnet`). Если мост однажды замолчит — первым делом смотреть срок годности в `/root/.claude/.credentials.json`: истёкший токен проявляется тишиной, а не ошибкой.

- [ ] **Шаг 2: Поставить мост**

```bash
cd /opt/steam-psycho && sudo bash deploy/llm-bridge-setup.sh
```

Ожидается: `✓` по обоим файлам и `active (running)` в статусе.

- [ ] **Шаг 3: Проверить живость**

```bash
curl -sS http://172.19.0.1:8788/health
```

Ожидается: `{"status":"ok","bin":"..."}`. `stale` означает, что шаг 1 не сработал.

- [ ] **Шаг 4: Проверить мост запросом, минуя сайт**

```bash
curl -sS -X POST http://172.19.0.1:8788/generate \
  -H "content-type: application/json" \
  -H "x-bridge-token: $(grep '^BRIDGE_TOKEN=' /etc/gamertype-llm-bridge.env | cut -d= -f2-)" \
  -d '{"system":"Отвечай одним словом.","prompt":"Скажи: работает"}'
```

Ожидается: `{"text":"работает",...}`.

- [ ] **Шаг 5: Переключить сайт на мост**

```bash
cd /opt/steam-psycho && sed -i 's/^LLM_PROVIDER=.*/LLM_PROVIDER=claude-bridge/' .env.local || echo 'LLM_PROVIDER=claude-bridge' >> .env.local
grep '^LLM_PROVIDER=' .env.local
docker compose up -d --build app
```

Ожидается: `LLM_PROVIDER=claude-bridge` и успешная пересборка.

- [ ] **Шаг 6: Проверить настоящей генерацией**

Открыть сайт, сгенерировать карточку по своему Steam-профилю, затем:

```bash
docker logs steam-psycho-app-1 --since 10m 2>&1 | grep '\[generate\]'
```

Ожидается строка с `claude-bridge`. Если там `anthropic` — мост отказал, причина будет в соседней строке `[llm]`.

- [ ] **Шаг 7: Проверить, что откат работает**

```bash
sudo systemctl stop gamertype-llm-bridge.service
```

Сгенерировать карточку по другому профилю, затем:

```bash
docker logs steam-psycho-app-1 --since 5m 2>&1 | grep -E '\[llm\]|\[generate\]'
sudo systemctl start gamertype-llm-bridge.service
```

Ожидается: предупреждение про недоступный мост и генерация с `anthropic`. Сайт при этом не должен отдавать ошибку — это и есть проверка того, ради чего задуман запасной путь.

---

## Порядок и зависимости

Task 1 → Task 2 (мост использует ограничитель).
Task 3 → Task 4 (поставщику нужен разбор JSON) → Task 5 (переключение использует поставщика).
Task 6 после Task 2 и Task 5. Task 7 последняя и требует участия владельца.

Tasks 1-2 и Tasks 3-5 независимы между собой и могут идти параллельно.

## Что осталось за рамками

Записано в спеке, в этот план намеренно не входит: ограничения доступа
(`DISABLE_GATE`), мердж ветки в master, публичная ссылка на результат,
переименование `portrait` в коде.
