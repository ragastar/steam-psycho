import { getStubProvider } from "./stub-provider";

/**
 * Приёмщик оплаты. Форма интерфейса намеренно повторяет ЮКассу — редирект на
 * страницу оплаты плюс вебхук с подтверждением, — потому что почти все
 * российские эквайеры устроены так же: подмена заглушки на боевую кассу будет
 * дешёвой, а остальной код о разнице знать не должен.
 */
export interface PaymentProvider {
  /** Пишется в заказ: поддельные заказы не должны смешаться с настоящими. */
  name: string;
  createPayment(o: {
    orderId: number;
    amountKop: number;
    locale: string;
  }): Promise<{ payUrl: string; providerOrderId: string }>;
  /**
   * Проверяет подтверждение от кассы. `rawBody` — СЫРОЕ тело запроса: подпись
   * считается по байтам, а не по разобранному и заново собранному JSON.
   * Любая осечка — null, то есть отказ.
   */
  verifyWebhook(rawBody: string, signature: string | null): { orderId: number; providerOrderId: string } | null;
}

/**
 * Заголовок, в котором касса присылает подпись. Живёт здесь, а не в файле
 * маршрута: оттуда экспортировать можно только обработчик и runtime, а имя
 * нужно ещё и тому, кто вебхук отправляет (страница поддельной кассы).
 */
export const PAYMENT_SIGNATURE_HEADER = "x-payment-signature";

/**
 * Кто сейчас принимает деньги. null — «касса не работает»: не выключенная
 * витрина, а именно отсутствие приёмщика.
 *
 * Переключатель один на три положения, а не россыпь флагов: `off` (по
 * умолчанию), `stub`, `live`. Значение читается на каждом вызове, а не при
 * загрузке модуля, — иначе режим замерзал бы на том, каким он был в момент
 * первого импорта.
 *
 * Неизвестное значение трактуется как `off`. Опечатка в переменной окружения
 * не должна включать кассу — ошибка обязана закрывать, а не открывать.
 */
export function getProvider(): PaymentProvider | null {
  const mode = process.env.PAYWALL_MODE;

  if (mode === "stub") return getStubProvider();

  if (mode === "live") {
    console.error("[billing] PAYWALL_MODE=live, но ЮКасса не подключена — приём оплат отключён");
    return null;
  }

  return null;
}
