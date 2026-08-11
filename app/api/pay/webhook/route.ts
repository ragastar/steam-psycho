import { NextResponse } from "next/server";
import { getProvider, PAYMENT_SIGNATURE_HEADER, MIN_WEBHOOK_SECRET_LENGTH } from "@/lib/billing/provider";
import { billingAvailable, findOrder, markCancelled, markPaid } from "@/lib/billing/store";

/**
 * Подтверждение оплаты от кассы. Единственное место, где заказ становится
 * оплаченным, — значит и единственное, через которое можно попытаться выдать
 * себе право даром. Любая осечка здесь закрывает, а не открывает.
 *
 * Коды ответа выбраны с оглядкой на повадки касс: 4xx они считают
 * окончательным ответом и повторять перестают, 5xx — временной бедой и
 * повторяют. Поэтому «нет такого заказа» — 404, а «у нас всё сломалось» —
 * обязательно 5xx, иначе деньги взяты, а право потеряно навсегда.
 */
export async function POST(req: Request) {
  // Секрет ОБЯЗАТЕЛЕН, а не «проверяем, если задан». Вторая форма в этом
  // проекте уже однажды открыла телеграм-вебхук всему миру: при пустой
  // переменной он принимал что угодно. Нет секрета — не принимаем ничего,
  // включая запросы вообще без подписи. Слишком короткий считается за
  // отсутствующий: его подберут локально, а в сеть уйдёт один запрос.
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret || secret.length < MIN_WEBHOOK_SECRET_LENGTH) {
    console.error(
      `[pay] PAYMENT_WEBHOOK_SECRET не задан или короче ${MIN_WEBHOOK_SECRET_LENGTH} знаков — приём подтверждений отключён`,
    );
    return NextResponse.json({ error: "webhook secret not configured" }, { status: 503 });
  }

  const provider = getProvider();
  if (!provider) {
    // Касса выключена (PAYWALL_MODE=off) или отказалась стартовать. Проверять
    // подпись некому — принимать подтверждения не от кого.
    return NextResponse.json({ error: "payments disabled" }, { status: 503 });
  }

  // СЫРОЕ тело, а не req.json(): подпись считается по тем самым байтам, что
  // прислала касса. Разобрать и собрать JSON заново — значит поменять байты
  // (порядок ключей, пробелы) и либо развалить подпись, либо, что хуже,
  // проверить подпись не того, что будет исполнено.
  const rawBody = await req.text();
  const verified = provider.verifyWebhook(rawBody, req.headers.get(PAYMENT_SIGNATURE_HEADER));
  if (!verified) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const order = findOrder(verified.orderId);
  if (!order) {
    // null от findOrder значит и «нет такого заказа», и «база не ответила».
    // Различить обязательно: недоступная база — состояние стойкое (файл не
    // открывается, миграция упала), и, отвечая на неё 404, мы бы окончательно
    // потеряли КАЖДУЮ оплату подряд.
    if (!billingAvailable()) {
      console.error(`[pay] база недоступна, подтверждение по заказу ${verified.orderId} не обработано`);
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }

  if (verified.outcome === "declined") {
    const cancelled = markCancelled(order.id);

    // "already" — повторный отказ по тому же заказу, штатный исход ретрая.
    if (cancelled === "cancelled" || cancelled === "already") {
      return NextResponse.json({ ok: true }, { status: 200 });
    }
    if (cancelled === "paid") {
      // Отказ по уже оплаченному заказу. Право не отбираем: возврат денег —
      // работа руками через кабинет банка и админку, а не тихая правка статуса
      // по запоздавшему вебхуку. Но человеку это видеть надо.
      console.error(`[pay] отказ пришёл по уже оплаченному заказу ${order.id} — разобрать руками`);
      return NextResponse.json({ error: "order already paid" }, { status: 409 });
    }
    if (cancelled === "unknown") {
      return NextResponse.json({ error: "order not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  // Отменённый заказ оплаченным не становится. Молча ответить кассе 200 нельзя:
  // она сочтёт, что всё хорошо, а покупатель не получит ничего — и никто об
  // этом не узнает.
  if (order.status === "cancelled") {
    console.error(`[pay] оплата пришла по отменённому заказу ${order.id} — разобрать руками`);
    return NextResponse.json({ error: "order cancelled" }, { status: 409 });
  }

  // Сверка суммы. Подпись говорит лишь, что тело написано тем, у кого есть
  // секрет; сколько денег реально пришло — отдельный вопрос, и без этой
  // проверки уведомление об уплате одной копейки открыло бы разбор за 199
  // рублей. Сумма должна СОВПАДАТЬ: переплата — такое же расхождение, как
  // недоплата, и разбирает его человек.
  if (order.amountKop !== verified.amountKop || order.currency !== verified.currency) {
    console.error(
      `[pay] заказ ${order.id}: заказано ${order.amountKop} ${order.currency}, ` +
        `подтверждено ${verified.amountKop} ${verified.currency} — право не выдано`,
    );
    return NextResponse.json({ error: "amount mismatch" }, { status: 409 });
  }

  const result = markPaid(order.id, verified.providerOrderId);

  // "already" — штатный исход: кассы шлют подтверждение по два раза, и второй
  // обязан быть тихим успехом, иначе касса будет ретраить бесконечно. Право
  // при этом одно — за это отвечает сам markPaid.
  if (result === "granted" || result === "already") {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (result === "unknown") {
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }

  console.error(`[pay] заказ ${order.id} не удалось перевести в оплаченный`);
  return NextResponse.json({ error: "unavailable" }, { status: 503 });
}

export const runtime = "nodejs";
