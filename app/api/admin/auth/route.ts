import { NextResponse } from "next/server";
import { createSessionCookie } from "@/lib/admin/auth";

export async function POST(req: Request) {
  try {
    const { password } = await req.json();
    const secret = process.env.ADMIN_SECRET;

    if (!secret || password !== secret) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const cookie = createSessionCookie();
    const response = NextResponse.json({ ok: true });
    response.cookies.set(cookie.name, cookie.value, cookie.options as Parameters<typeof response.cookies.set>[2]);

    return response;
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
