import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const ART_DIR = process.env.ART_STORAGE_PATH || path.join(process.cwd(), "data", "art");

export async function POST(req: Request) {
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  const secret = process.env.ADMIN_SECRET;

  if (!secret || token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    if (!fs.existsSync(ART_DIR)) {
      return NextResponse.json({ success: true, message: "Art folder empty", deleted: 0 });
    }

    const files = fs.readdirSync(ART_DIR).filter((f) => f.endsWith(".png"));
    for (const file of files) {
      fs.unlinkSync(path.join(ART_DIR, file));
    }

    console.log(`[admin] Art cleared — ${files.length} files deleted`);
    return NextResponse.json({ success: true, message: `Deleted ${files.length} art files`, deleted: files.length });
  } catch (err) {
    console.error("[admin] Art clear failed:", err);
    return NextResponse.json({ error: "Clear failed" }, { status: 500 });
  }
}
