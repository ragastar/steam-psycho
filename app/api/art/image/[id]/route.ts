import { NextResponse } from "next/server";
import fs from "fs";
import { getArtFilePath, artFileExists } from "@/lib/art/image-client";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const steamId64 = params.id;

  if (!artFileExists(steamId64)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const filePath = getArtFilePath(steamId64);
  const buffer = fs.readFileSync(filePath);

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=2592000, immutable",
    },
  });
}
