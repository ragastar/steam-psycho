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
  // Защита от плохой конфигурации (например, из переменных окружения через
  // Number(...): Number(undefined) === NaN, Number("") === 0).
  //
  // Без этой проверки при maxConcurrent <= 0 условие "active >= maxConcurrent"
  // в pump() истинно всегда, потому что active никогда не бывает отрицательным
  // — задача из очереди не достаётся никогда, а run() продолжает ПРИНИМАТЬ
  // вызовы (пока waiting.length < queueMax), и их обещания не разрешаются и
  // не отклоняются никогда. Это тихое зависание — худший исход для моста,
  // чьё требование — отказывать сразу. Поэтому падаем явно при создании.
  //
  // NaN проверяем через Number.isInteger — оно возвращает false и для NaN,
  // и для не-целых, и для строк, так что отдельная проверка на NaN не нужна.
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new Error(
      `createLimiter: maxConcurrent должен быть целым числом >= 1, получено: ${maxConcurrent}`,
    );
  }
  if (!Number.isInteger(queueMax) || queueMax < 0) {
    throw new Error(
      `createLimiter: queueMax должен быть целым числом >= 0, получено: ${queueMax}`,
    );
  }

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
