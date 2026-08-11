import { NextResponse } from "next/server";
import { getCache } from "@/lib/cache/redis";
import { gateTokenKey } from "@/lib/cache/keys";

interface GateData {
  steamId64: string;
  locale: string;
  status: "pending" | "unlocked";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ status: "expired" });
  }

  try {
    const data = await getCache<GateData>(gateTokenKey(token));

    if (!data) {
      return NextResponse.json({ status: "expired" });
    }

    return NextResponse.json({ status: data.status });
  } catch {
    // Раньше здесь стояло "unlocked": любая ошибка кеша открывала доступ.
    // Сбой не должен раздавать платное — отвечаем «ещё не открыто».
    return NextResponse.json({ status: "pending" });
  }
}
