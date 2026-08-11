/**
 * Достаёт адрес клиента для лимита запросов.
 *
 * Брать ПЕРВЫЙ элемент X-Forwarded-For нельзя: этот заголовок присылает сам
 * клиент, а прокси лишь дописывает свой адрес в конец. Раньше лимит обходился
 * подстановкой любого адреса в заголовок — а за каждым запросом стоит платный
 * вызов модели. Последний элемент дописывает наш прокси, ему и верим.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
