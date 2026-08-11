import { NextResponse } from "next/server";
import { billingAvailable, findOrder } from "@/lib/billing/store";
import { readSessionFromRequest } from "@/lib/identity/session";

interface Context {
  // В Next 15+ параметры маршрута приходят промисом.
  params: Promise<{ orderId: string }>;
}

/**
 * Статус заказа для страницы возврата.
 *
 * Наружу уезжают ровно два поля: чем кончился заказ и на какой разбор он был.
 * Ни суммы, ни ключа идемпотентности, ни номера платежа в кассе здесь быть не
 * должно — странице возврата они не нужны, а любое лишнее поле однажды
 * окажется на экране.
 *
 * «Нет такого заказа» и «заказ чужой» отвечают ОДИНАКОВО: разные коды
 * превратили бы этот маршрут в способ перебрать чужие номера и узнать, кто и
 * что покупал.
 */
export async function GET(req: Request, { params }: Context) {
  const accountId = readSessionFromRequest(req);
  // Без входа спрашивать не о чем: заказ принадлежит аккаунту. 401, а не 404, —
  // это единственный отказ, который человек может исправить сам.
  if (!accountId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { orderId } = await params;
  const id = Number(orderId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }

  const order = findOrder(id);
  if (!order) {
    // null от findOrder значит и «нет такого заказа», и «база не ответила».
    // Второе — беда стойкая, и страница возврата обязана отличить её от
    // окончательного «такого заказа нет»: человек уже отдал деньги.
    if (!billingAvailable()) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }

  if (order.accountId !== accountId) {
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }

  return NextResponse.json({ status: order.status, steamId64: order.steamId64 });
}

export const runtime = "nodejs";
