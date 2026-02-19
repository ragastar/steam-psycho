import { registerHandlers } from "@/lib/telegram/handlers";
import { getWebhookCb } from "@/lib/telegram/bot";

registerHandlers();

export async function POST(req: Request) {
  try {
    const cb = getWebhookCb();
    return await cb(req);
  } catch {
    // Always return 200 to Telegram to prevent retry storms
    return new Response("ok", { status: 200 });
  }
}
