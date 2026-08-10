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
