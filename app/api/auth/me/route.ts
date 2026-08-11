import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/identity/session";
import { listIdentities } from "@/lib/identity/store";

export async function GET() {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ accountId: null, identities: [] });

  // Идентификаторы наружу НЕ отдаём: браузеру достаточно знать, какие способы
  // привязаны. Номер телеграма — лишние данные в чужих руках.
  return NextResponse.json({
    accountId,
    identities: listIdentities(accountId).map((i) => ({ provider: i.provider, verified: i.verified })),
  });
}

export const runtime = "nodejs";
