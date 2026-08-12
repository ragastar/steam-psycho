import { NextResponse } from "next/server";
import { logFeedback, FEEDBACK_MAX_TEXT, FEEDBACK_MAX_CONTACT } from "@/lib/analytics/db";
import { hashIp } from "@/lib/analytics/hash";
import { getClientIp } from "@/lib/http/client-ip";
import { incrementRateLimit } from "@/lib/cache/redis";
import { CACHE_TTL } from "@/lib/cache/keys";

/** Пустое и односимвольное — это промах по кнопке, а не обратная связь. */
const MIN_TEXT = 2;

/**
 * Обратная связь с сайта.
 *
 * Доступ не проверяется намеренно: сказать «ваша шляпа не работает» должен мочь
 * и тот, кто ничего не покупал. Защита здесь от мусора, а не от людей — потолок
 * на адрес и на длину.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req);

  try {
    const count = await incrementRateLimit(`ratelimit:feedback:${ip}`, CACHE_TTL.rateLimit);
    const limit = parseInt(process.env.FEEDBACK_RATE_LIMIT_PER_HOUR || "10", 10);
    if (count > limit) {
      return NextResponse.json(
        { error: true, message: "Слишком часто, попробуй позже" },
        { status: 429 },
      );
    }

    const body = await req.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const contact = typeof body?.contact === "string" ? body.contact.trim() : "";
    const steamId64 = typeof body?.steamId64 === "string" ? body.steamId64.slice(0, 32) : undefined;
    const page = typeof body?.page === "string" ? body.page.slice(0, 200) : undefined;

    if (text.length < MIN_TEXT) {
      return NextResponse.json({ error: true, message: "Напиши хоть что-нибудь" }, { status: 400 });
    }

    const stored = logFeedback({
      text: text.slice(0, FEEDBACK_MAX_TEXT),
      contact: contact.slice(0, FEEDBACK_MAX_CONTACT) || undefined,
      steamId64,
      page,
      ipHash: hashIp(ip),
    });

    // База недоступна — врать «спасибо, записали» нельзя: человек потратил
    // время, а сообщение никуда не легло.
    if (!stored) {
      return NextResponse.json(
        { error: true, message: "Не смогли записать, попробуй позже" },
        { status: 503 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[feedback] ошибка:", err);
    return NextResponse.json({ error: true, message: "Не смогли записать" }, { status: 500 });
  }
}
