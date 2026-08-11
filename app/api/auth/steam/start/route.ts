import { NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/identity/steam-openid";
import { SITE_URL } from "@/lib/site";

export async function GET() {
  return NextResponse.redirect(buildAuthUrl(`${SITE_URL}/api/auth/steam/callback`, SITE_URL));
}
