import { NextResponse } from "next/server";
import { getDb } from "@/lib/analytics/db";

export async function POST(req: Request) {
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  const secret = process.env.ADMIN_SECRET;

  if (!secret || token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    if (!db) {
      return NextResponse.json({ error: "DB not available" }, { status: 500 });
    }

    db.exec(`
      DELETE FROM analyses;
      DELETE FROM errors;
      DELETE FROM art_generations;
      DELETE FROM gate_events;
    `);

    console.log("[admin] Analytics reset — all tables cleared");
    return NextResponse.json({ success: true, message: "All analytics tables cleared" });
  } catch (err) {
    console.error("[admin] Analytics reset failed:", err);
    return NextResponse.json({ error: "Reset failed" }, { status: 500 });
  }
}
