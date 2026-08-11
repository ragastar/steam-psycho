import { NextResponse } from "next/server";
import { getProvider, PAYMENT_SIGNATURE_HEADER } from "@/lib/billing/provider";
import { findOrder, markPaid } from "@/lib/billing/store";

/**
 * Подтверждение оплаты от кассы. Единственное место, где заказ становится
 * оплаченным, — значит и единственное, через которое можно попытаться выдать
 * себе право даром. Любая осечка здесь закрывает, а не открывает.
 */
export async function POST(req: Request) {
  // Секрет ОБЯЗАТЕЛЕН, а не «проверяем, если задан». Вторая форма в этом
  // проекте уже однажды открыла телеграм-вебхук всему миру: при пустой
  // переменной он принимал что угодно. Нет секрета — не принимаем ничего,
  // включая запросы вообще без подписи.
  if (!process.env.PAYMENT_WEBHOOK_SECRET) {
    console.error("[pay] PAYMENT_WEBHOOK_SECRET не задан — приём подтверждений отключён");
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

  if (!findOrder(verified.orderId)) {
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }

  const result = markPaid(verified.orderId, verified.providerOrderId);

  // "already" — штатный исход: кассы шлют подтверждение по два раза, и второй
  // обязан быть тихим успехом, иначе касса будет ретраить бесконечно. Право
  // при этом одно — за это отвечает сам markPaid.
  if (result === "granted" || result === "already") {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Заказ был виден строкой выше, а подтвердить его не вышло — это сбой на
  // нашей стороне, а не «нет такого заказа». Отвечаем 5xx, чтобы касса
  // повторила: на 404 она бросит попытки, и оплата потеряется.
  console.error(`[pay] заказ ${verified.orderId} не удалось перевести в оплаченный`);
  return NextResponse.json({ error: "unavailable" }, { status: 503 });
}

export const runtime = "nodejs";
