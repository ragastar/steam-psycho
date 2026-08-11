import { NextResponse } from "next/server";
import { PAYMENT_SIGNATURE_HEADER } from "@/lib/billing/provider";
import { getStubProvider, signStubWebhook } from "@/lib/billing/stub-provider";
import { billingAvailable, findOrder } from "@/lib/billing/store";
import { readSessionFromRequest } from "@/lib/identity/session";

interface Context {
  // В Next 15+ параметры маршрута приходят промисом.
  params: Promise<{ orderId: string }>;
}

/**
 * Готовит подтверждение поддельной кассы — и только готовит.
 *
 * Отправляет его в вебхук БРАУЗЕР, обычным fetch на относительный
 * `/api/pay/webhook`. Отправлять с сервера самому себе — значит угадывать
 * собственный адрес: в контейнере за nginx он один, в разработке другой, а
 * SITE_URL вшивается при сборке и на боевом образе указывает на живой сайт.
 * Ошибка тут отправила бы подтверждение не туда. А так проверяется весь путь
 * целиком — маршрутизация, заголовок подписи, рантайм, — ровно как приходит
 * настоящий банк.
 *
 * Секрет в браузер не уезжает: подпись считает сервер. То, что браузер видит, —
 * подпись тела, придуманного сервером для ЕГО СОБСТВЕННОГО заказа, и повторная
 * отправка её ничего не даёт: вебхук идемпотентен.
 *
 * Ни одно поле подтверждения браузер не задаёт — всё берётся из заказа. Иначе
 * поддельная касса стала бы способом подтвердить любую сумму по любому заказу.
 */
export async function POST(req: Request, { params }: Context) {
  // Единственная дверь к поддельной кассе, и оба предохранителя внутри неё:
  // режим должен быть `stub`, а в боевом окружении нужно ещё и явное
  // PAYWALL_ALLOW_STUB_IN_PROD=true. Нет кассы — нет и маршрута.
  if (!getStubProvider()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const accountId = readSessionFromRequest(req);
  const { orderId } = await params;
  const id = Number(orderId);

  // «Не вошёл», «номер не число», «заказа нет» и «заказ чужой» отвечают
  // одинаково: по разнице кодов чужие заказы перебираются.
  if (!accountId || !Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const order = findOrder(id);
  if (!order) {
    if (!billingAvailable()) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (order.accountId !== accountId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  // Ровно два исхода и ничего больше: «неизвестный» не должен читаться как
  // «наверное, оплачено».
  const { outcome } = payload as Record<string, unknown>;
  if (outcome !== "paid" && outcome !== "declined") {
    return NextResponse.json({ error: "bad outcome" }, { status: 400 });
  }

  // Тело собирается из ЗАКАЗА. Сумма и валюта — те, по которым заказ заведён:
  // вебхук потом сверяет уплаченное именно с ним.
  const body = JSON.stringify({
    orderId: order.id,
    providerOrderId: `stub-${order.id}`,
    outcome,
    amountKop: order.amountKop,
    currency: order.currency,
  });

  let signature: string;
  try {
    signature = signStubWebhook(body);
  } catch (err) {
    // Подписывать нечем — секрета нет. Молча вернуть тело без подписи нельзя:
    // вебхук откажет, а человек увидит непонятную ошибку вместо честного «касса
    // не настроена».
    console.error("[pay] поддельная касса не смогла подписать подтверждение:", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  // `body` отдаётся строкой, а не объектом, намеренно: подпись считается по
  // байтам, и пересобранный в браузере JSON (другой порядок ключей, другие
  // пробелы) её бы развалил. Имя заголовка тоже приходит отсюда — тянуть
  // lib/billing/provider в клиентский компонент нельзя, за ним crypto и вся
  // поддельная касса.
  return NextResponse.json({ body, signature, header: PAYMENT_SIGNATURE_HEADER });
}

export const runtime = "nodejs";
