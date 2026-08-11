import crypto from "crypto";
import { NextResponse } from "next/server";
import { paywallMode } from "@/lib/access/entitlement";
import { PRICE_KOP } from "@/lib/billing/price";
import { getProvider } from "@/lib/billing/provider";
import {
  billingAvailable,
  createOrder,
  findOpenOrder,
  findOrder,
  hasEntitlement,
  type Order,
} from "@/lib/billing/store";
import { CACHE_TTL, payCreateKey } from "@/lib/cache/keys";
import { incrementRateLimit } from "@/lib/cache/redis";
import { getClientIp } from "@/lib/http/client-ip";
import { readSessionFromRequest } from "@/lib/identity/session";

/** Попыток начать покупку с одного адреса в час, если в окружении не сказано иное. */
const DEFAULT_RATE_LIMIT = 20;

/**
 * Начало покупки: заводит заказ и отдаёт адрес кассы.
 *
 * Денег здесь ещё нет — их берёт касса, а право выдаёт вебхук. Задача этого
 * маршрута ровно одна: не наплодить лишних заказов и не начать оплату того,
 * что уже куплено.
 *
 * Порядок отказов выбран так, чтобы заказ не появлялся зря: сначала «продавать
 * нечего» (касса выключена), потом «непонятно, что покупают», потом «непонятно,
 * кто покупает», и только затем разговор с базой.
 *
 * У каждого отказа в теле есть `code`, и различает он не подробности поломки, а
 * СРОК: `no_provider` — «касса не подключена», это навсегда до вмешательства
 * владельца; `temporary` — «сейчас не вышло, попробуйте снова». Витрина по нему
 * выбирает текст, и разница здесь не косметическая: при `live` без подключённой
 * ЮКассы приёмщика нет ВСЕГДА, и совет «попробуй ещё раз» на каждое нажатие —
 * обещание, которое не может сбыться ни разу.
 */
export async function POST(req: Request) {
  // Касса выключена — покупать нечего, и это не ошибка, а положение
  // переключателя: при `off` доступ и так полный у всех, кнопки покупки на
  // странице нет вовсе. 404, а не 403: маршрута для покупки в этом режиме
  // просто не существует.
  if (paywallMode() === "off") {
    return NextResponse.json({ error: "payments disabled", code: "no_provider" }, { status: 404 });
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

  const { steamId64, locale } = payload as Record<string, unknown>;

  // Ровно 17 цифр — та же форма, что принимает весь остальной сайт
  // (lib/steam/resolve.ts). Из этой строки складывается ключ идемпотентности и
  // запись заказа, поэтому проверять её надо здесь, а не надеяться на базу.
  if (typeof steamId64 !== "string" || !/^\d{17}$/.test(steamId64)) {
    return NextResponse.json({ error: "bad steamId64" }, { status: 400 });
  }

  // Локаль уезжает в ПУТЬ адреса оплаты, поэтому берём не то, что прислали, а
  // одно из двух известных значений: «../../» в этом месте увело бы человека с
  // кассы куда угодно.
  const safeLocale = locale === "en" ? "en" : "ru";

  const accountId = readSessionFromRequest(req);
  if (!accountId) {
    // Вход просят ровно здесь и нигде больше (решение владельца): витрина
    // получает `needLogin` и разворачивает панель входа прямо под кнопкой.
    return NextResponse.json({ needLogin: true }, { status: 401 });
  }

  // Потолок стоит ПОСЛЕ проверки входа: без сессии заказ и так не появляется,
  // а вот вошедший (аккаунт заводится за секунды) может слать сюда POST в цикле
  // с любыми семнадцатизначными номерами — существование профиля здесь не
  // проверяется намеренно, чужой разбор купить можно, — и каждый новый номер
  // это новая строка в том же файле SQLite, где лежат аккаунты и права.
  const rateLimit = parseInt(process.env.PAY_RATE_LIMIT_PER_HOUR || "", 10) || DEFAULT_RATE_LIMIT;
  const attempts = await incrementRateLimit(payCreateKey(getClientIp(req)), CACHE_TTL.rateLimit);
  if (attempts > rateLimit) {
    return NextResponse.json({ error: "too many", code: "temporary" }, { status: 429 });
  }

  // Недоступная база — это НЕ «прав нет, продадим ещё раз»: hasEntitlement при
  // беде с базой отвечает false, и без этой проверки человек, уже купивший
  // разбор, начал бы платить второй раз. 5xx честно говорит «у нас сломалось».
  if (!billingAvailable()) {
    console.error("[pay] база недоступна — начать покупку нечем");
    return NextResponse.json({ error: "unavailable", code: "temporary" }, { status: 503 });
  }

  // Право проверяется ДО создания заказа: уже купил — заказа не будет.
  if (hasEntitlement(accountId, steamId64)) {
    return NextResponse.json({ alreadyOwned: true }, { status: 409 });
  }

  // Приёмщик спрашивается тоже до создания заказа: при `live` его сегодня нет,
  // и заказ без кассы остался бы висеть сиротой.
  const provider = getProvider();
  if (!provider) {
    console.error("[pay] приёмщик оплаты недоступен — заказ не создаётся");
    return NextResponse.json({ error: "payments unavailable", code: "no_provider" }, { status: 503 });
  }

  const order = openOrderFor(accountId, steamId64, provider.name);
  if (!order) {
    return NextResponse.json({ error: "unavailable", code: "temporary" }, { status: 503 });
  }

  try {
    // Сумму берём из ЗАКАЗА, а не из константы: у переиспользованного заказа
    // она могла быть заведена по старой цене, а вебхук потом сверяет уплаченное
    // именно с заказом.
    const payment = await provider.createPayment({
      orderId: order.id,
      amountKop: order.amountKop,
      locale: safeLocale,
    });
    return NextResponse.json({ payUrl: payment.payUrl });
  } catch (err) {
    // Касса не ответила. Заказ остаётся незакрытым — следующее нажатие
    // подхватит его, а не заведёт второй.
    console.error("[pay] касса не отдала адрес оплаты:", err);
    return NextResponse.json({ error: "unavailable", code: "temporary" }, { status: 503 });
  }
}

/**
 * Заказ, по которому человек пойдёт платить: либо уже начатый, либо новый.
 *
 * Двойное нажатие защищено дважды, и оба раза не зря:
 *
 * 1. `findOpenOrder` ловит обычный случай — второе нажатие приходит после того,
 *    как первое уже записало заказ.
 * 2. Постоянный ключ идемпотентности ловит гонку — два запроса, дошедшие до
 *    вставки одновременно: `orders.idempotency_key` уникален, и второй получит
 *    существующий заказ вместо нового.
 *
 * Ключ постоянный, а не случайный, ровно ради второго пункта — но именно
 * поэтому он рано или поздно совпадёт с УЖЕ ЗАКРЫТЫМ заказом (банк отказал,
 * заказ отменён). Платить по такому заказу нельзя: касса по нему денег не
 * возьмёт. Поэтому закрытый заказ — повод завести новый с солёным ключом.
 *
 * Приёмщик заказа обязан совпасть с сегодняшним, и это не формальность.
 * Брошенный заказ — самый частый исход по самой же спеке, а поддельная касса
 * включается раньше настоящей. Без сверки владелец переключил бы `live`,
 * вернувшийся посетитель получил бы свой старый заказ с `provider = 'stub'`,
 * заплатил бы настоящими деньгами — и в отчётах эта оплата лежала бы тестовой.
 * При сверке с банком такие строки выглядят расхождением.
 */
function openOrderFor(accountId: number, steamId64: string, providerName: string): Order | null {
  const open = findOpenOrder(accountId, steamId64);
  if (open && open.provider === providerName) return open;

  const key = `pay:v1:${accountId}:${steamId64}:${PRICE_KOP}`;
  const created = createOrder({
    accountId,
    steamId64,
    amountKop: PRICE_KOP,
    provider: providerName,
    idempotencyKey: key,
  });
  if (!created) return null;

  const order = findOrder(created.id);
  if (!order) return null;
  if (order.status === "created" && order.provider === providerName) return order;

  // Ключ совпал с чужим заказом — закрытым либо заведённым другой кассой:
  // постоянный ключ складывается из тех же аккаунта, разбора и цены. Соль
  // делает попытку разовой: защита от гонки на ней уже не держится, но гонка
  // здесь означала бы всего лишь второй брошенный заказ, а не вторую оплату —
  // деньги берёт касса, а на кассу человек уходит по одному адресу.
  const salted = createOrder({
    accountId,
    steamId64,
    amountKop: PRICE_KOP,
    provider: providerName,
    idempotencyKey: `${key}:${crypto.randomUUID()}`,
  });
  return salted ? findOrder(salted.id) : null;
}

export const runtime = "nodejs";
