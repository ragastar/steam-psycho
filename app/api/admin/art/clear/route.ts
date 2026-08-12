import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { steamIdHasEntitlement } from "@/lib/billing/store";

const ART_DIR = process.env.ART_STORAGE_PATH || path.join(process.cwd(), "data", "art");

export async function POST(req: Request) {
  const { token, includePurchased } = (await req.json().catch(() => ({}))) as {
    token?: string;
    includePurchased?: boolean;
  };
  const secret = process.env.ADMIN_SECRET;

  if (!secret || token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const dir = process.env.ART_STORAGE_PATH || ART_DIR;
    if (!fs.existsSync(dir)) {
      return NextResponse.json({ success: true, message: "Art folder empty", deleted: 0, kept: 0 });
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png"));
    let deleted = 0;
    let kept = 0;

    for (const file of files) {
      // Картинка купленного разбора — оплаченный товар. Снести её значит и
      // заплатить за перерисовку заново, и подменить человеку карточку, за
      // которую он платил: рисуется каждый раз новое. Убирается только по
      // явному требованию.
      const steamId64 = file.replace(/\.png$/, "");
      if (!includePurchased && steamIdHasEntitlement(steamId64)) {
        kept++;
        continue;
      }
      fs.unlinkSync(path.join(dir, file));
      deleted++;
    }

    console.log(`[admin] арт очищен — удалено ${deleted}, сохранено купленных ${kept}`);
    return NextResponse.json({
      success: true,
      message: `Удалено ${deleted}, сохранено купленных ${kept}`,
      deleted,
      kept,
    });
  } catch (err) {
    console.error("[admin] Art clear failed:", err);
    return NextResponse.json({ error: "Clear failed" }, { status: 500 });
  }
}
