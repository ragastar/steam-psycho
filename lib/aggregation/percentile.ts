/**
 * Доля выборки, которая строго меньше значения, в процентах.
 *
 * Нужна, чтобы перестать выдавать за перцентили захардкоженные пороги.
 * Считается по нашей собственной накопленной статистике, поэтому и
 * подписывать результат надо честно: «среди прошедших тест», а не
 * «среди всех игроков Steam».
 */
export function percentileRank(values: number[], value: number): number {
  if (values.length === 0) return 0;
  let below = 0;
  for (const v of values) if (v < value) below++;
  return Math.round((below / values.length) * 100);
}

/** Ниже этого размера выборки собственная статистика ещё ничего не значит. */
export const MIN_SAMPLE_FOR_REAL_PERCENTILES = 50;
