import crypto from "crypto";
import type { PaymentProvider } from "./provider";

/**
 * Поддельная касса. Смысл её не в том, чтобы «нарисовать успех», а в том,
 * чтобы прогнать весь путь целиком: она дёргает тот же вебхук, что и настоящая
 * касса, со своей подписью — проверяются приём, подпись, защита от повторов и
 * выдача права.
 */

/** HMAC-SHA256 в hex: всегда 64 знака, какой бы длины ни было тело. */
function hmac(rawBody: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * Подписывает подтверждение тем же секретом, которым его потом проверяет
 * вебхук. Считает подпись сервер, не браузер: секрет в браузер не уезжает.
 *
 * Без секрета бросает, а не возвращает пустую строку: пустая строка выглядела
 * бы как подпись и поехала бы в запрос, а отказать должна именно попытка
 * подписать нечем.
 */
export function signStubWebhook(rawBody: string): string {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("PAYMENT_WEBHOOK_SECRET не задан — подписывать подтверждение нечем");
  }
  return hmac(rawBody, secret);
}

const stubProvider: PaymentProvider = {
  name: "stub",

  async createPayment({ orderId, locale }) {
    // Своя страница вместо чужой платёжной формы; заказ помечен приёмщиком,
    // которым создан, — по префиксу видно, что деньги ненастоящие.
    return { payUrl: `/${locale}/pay/${orderId}`, providerOrderId: `stub-${orderId}` };
  },

  verifyWebhook(rawBody, signature) {
    if (!signature) return null;

    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    // Дублирует проверку маршрута намеренно: приёмщик не должен зависеть от
    // того, что кто-то выше по цепочке не забыл проверить секрет.
    if (!secret) return null;

    const expected = hmac(rawBody, secret);

    // timingSafeEqual падает на буферах разной длины, поэтому длину сравниваем
    // заранее. Сравниваем именно hex-СТРОКИ как байты utf8: Buffer.from(s,"hex")
    // молча обрезает всё после первого непарного знака, и тогда огрызок подписи
    // сошёлся бы с огрызком ожидаемой.
    const got = Buffer.from(signature, "utf8");
    const want = Buffer.from(expected, "utf8");
    if (got.length !== want.length) return null;
    if (!crypto.timingSafeEqual(got, want)) return null;

    // Подпись сошлась — значит тело написано тем, у кого есть секрет. Но форму
    // тела всё равно проверяем: подпись подтверждает происхождение, а не то,
    // что внутри лежит номер заказа.
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return null;
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;

    const { orderId, providerOrderId, outcome, amountKop, currency } = payload as Record<string, unknown>;
    if (typeof orderId !== "number" || !Number.isInteger(orderId) || orderId <= 0) return null;
    if (typeof providerOrderId !== "string" || providerOrderId === "") return null;
    // Неизвестный исход — это не «наверное, оплачено». Тело, молчащее о том,
    // чем кончился платёж, обязано читаться как отказ.
    if (outcome !== "paid" && outcome !== "declined") return null;
    if (typeof amountKop !== "number" || !Number.isInteger(amountKop) || amountKop <= 0) return null;
    if (typeof currency !== "string" || currency === "") return null;

    return { orderId, providerOrderId, outcome, amountKop, currency };
  },
};

/**
 * Единственная дверь к поддельной кассе — и оба предохранителя стоят в ней, а
 * не в getProvider(): обойти их, импортировав заглушку напрямую, не должно
 * получаться ни у витрины покупки, ни у страницы оплаты.
 *
 * 1. Режим. `stub` и `off` — это одно значение на три положения, а не два
 *    независимых флага: при выключенной кассе поддельной кассы не существует.
 * 2. Боевое окружение. Приём ненастоящих денег на живом сайте владелец
 *    включает осознанно — значит переменная задаётся руками, а не
 *    подразумевается.
 */
export function getStubProvider(): PaymentProvider | null {
  if (process.env.PAYWALL_MODE !== "stub") return null;

  if (process.env.NODE_ENV === "production" && process.env.PAYWALL_ALLOW_STUB_IN_PROD !== "true") {
    console.error(
      "[billing] поддельная касса запрошена в боевом окружении без PAYWALL_ALLOW_STUB_IN_PROD=true — отказ",
    );
    return null;
  }
  return stubProvider;
}
