import { NextResponse } from "next/server";
import { getAvailableProviders } from "@/lib/llm/client";

export async function GET() {
  const providers = getAvailableProviders();
  return NextResponse.json({ providers });
}
