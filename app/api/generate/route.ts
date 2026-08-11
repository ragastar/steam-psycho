import { NextResponse } from "next/server";
import { generatePortrait } from "@/lib/llm/client";
import { applyComputedFacts } from "@/lib/llm/facts";
import { getCache, setCache, incrementRateLimit } from "@/lib/cache/redis";
import { persistPurchased } from "@/lib/cache/purchased";
import { steamIdHasEntitlement } from "@/lib/billing/store";
import { paywallMode } from "@/lib/access/entitlement";
import { CACHE_TTL, portraitKey, profileKey, cardStatsKey, rarityKey, rateLimitKey } from "@/lib/cache/keys";
import { selectCardIdentity } from "@/lib/art/card-identity";
import { logAnalysis, logError } from "@/lib/analytics/db";
import { hashIp } from "@/lib/analytics/hash";
import { getClientIp } from "@/lib/http/client-ip";
import type { AggregatedProfile } from "@/lib/aggregation/types";
import type { CardStats } from "@/lib/aggregation/aggregate";
import type { Rarity } from "@/lib/llm/types";

export async function POST(req: Request) {
  const ip = getClientIp(req);

  try {
    // Rate limiting
    const rateLimitCount = await incrementRateLimit(rateLimitKey(ip), CACHE_TTL.rateLimit);
    const rateLimit = parseInt(process.env.RATE_LIMIT_PER_HOUR || "30", 10);
    if (rateLimitCount > rateLimit) {
      return NextResponse.json(
        { error: true, code: "RATE_LIMITED", message: "Too many requests" },
        { status: 429 },
      );
    }

    const body = await req.json();
    const { steamId64, locale = "ru" } = body as {
      steamId64: string;
      locale?: string;
    };

    if (!steamId64 || typeof steamId64 !== "string") {
      return NextResponse.json(
        { error: true, code: "INVALID_INPUT", message: "steamId64 is required" },
        { status: 400 },
      );
    }

    // Проверки доступа здесь НЕТ намеренно: генерация бесплатна.
    //
    // Она тут стояла и запирала сама себя. При включённой кассе портрет не
    // создавался ни у кого, кроме уже заплативших, — а платить было не за что,
    // потому что бесплатного вердикта никто никогда не видел. Спека требует
    // обратного порядка: сначала разбор и генерация, потом деньги.
    //
    // Защита, ради которой проверку ставили («платный портрет уезжает любому,
    // кто знает Steam ID»), теперь надёжнее: платного текста в браузере нет
    // вовсе, его вырезает toFreePortrait на сервере. Расход ограничен лимитом
    // по IP выше и требованием, чтобы профиль уже лежал в кеше (иначе
    // DATA_EXPIRED ниже). Арт остаётся платным — там проверка на месте.

    const ipHash = hashIp(ip);

    // 1. Check if portrait already cached
    const cachedPortrait = await getCache(portraitKey(steamId64, locale));
    if (cachedPortrait) {
      console.log(`[generate] ${steamId64} portrait already cached`);
      return NextResponse.json({ status: "ready" });
    }

    // 2. Load profile data from cache
    const [profile, cardStats, rarity] = await Promise.all([
      getCache<AggregatedProfile>(profileKey(steamId64)),
      getCache<CardStats>(cardStatsKey(steamId64)),
      getCache<Rarity>(rarityKey(steamId64)),
    ]);

    if (!profile || !cardStats || !rarity) {
      return NextResponse.json(
        { error: true, code: "DATA_EXPIRED", message: "Profile data expired. Please re-analyze." },
        { status: 410 },
      );
    }

    // 3. Generate portrait via LLM
    const t0 = Date.now();
    const generated = await generatePortrait(profile, cardStats, rarity, locale);
    const u = generated.usage;
    const usageNote = u
      ? ` ввод ${u.input} (из кеша ${u.cachedInput}), вывод ${u.output}`
      : "";
    console.log(
      `[generate] ${steamId64} LLM: ${Date.now() - t0}ms (${generated.provider}/${generated.model})${usageNote}`,
    );

    // Числа берём свои: модель регулярно перевирает статы, которые ей дали.
    const portrait = applyComputedFacts(generated.portrait, cardStats, rarity);

    // 4. Load card identity (cached during analyze)
    const cardIdentity = await getCache<{ element: string }>(`art:identity:${steamId64}`)
      || selectCardIdentity(profile, cardStats, steamId64);

    // 5. Cache portrait
    //
    // Купленный разбор хранится очень долго, а не сутки. Право проверяется на
    // ЛЮБОЙ аккаунт: карточка в кеше одна на всех, кто открывает эту страницу,
    // и выбрасывать через сутки то, за что кто-то заплатил, нельзя. Второй
    // конец этой же заботы — в вебхуке (lib/cache/purchased.ts): к моменту
    // покупки карточка уже лежит, и сюда исполнение больше не заходит.
    //
    // Режим спрашивается ПЕРЕД базой: при `PAYWALL_MODE=off` заказов не
    // существует, а обращение к store открыло бы файл SQLite и прогнало
    // миграцию таблиц оплаты на каждую генерацию. Прав это не даёт и ничего не
    // ломает, но обещание «при `off` всё ровно как до этой работы» перестаёт
    // быть буквальным, а «ровно как раньше» — единственный способ откатиться.
    const purchased = paywallMode() !== "off" && steamIdHasEntitlement(steamId64);
    await setCache(
      portraitKey(steamId64, locale),
      portrait,
      purchased ? CACHE_TTL.purchased : CACHE_TTL.portrait,
    );
    // Спутники карточки (разобранный профиль, цифры, редкость) живут сутки и
    // без них страница отвечает «данные устарели». Купленному это не годится.
    if (purchased) await persistPurchased(steamId64);

    logAnalysis({
      steamId64, locale, cached: false, ipHash,
      rarity,
      stats: cardStats,
      primaryArchetype: portrait.primaryArchetype?.name,
      spiritAnimal: portrait.spirit_animal?.name,
      element: cardIdentity.element,
      librarySize: profile.stats.totalGames,
      totalPlaytimeHours: profile.stats.totalPlaytimeHours,
      accountAgeYears: profile.timeline?.accountAge,
      // Пишем то, что реально отработало, а не значение из настроек.
      llmProvider: `${generated.provider}/${generated.model}`,
    });

    return NextResponse.json({ status: "generated" });
  } catch (err) {
    console.error("[generate] error:", err);
    logError({
      type: "GENERATE_ERROR",
      message: err instanceof Error ? err.message : "Unknown",
      ipHash: hashIp(ip),
      endpoint: "/api/generate",
    });
    return NextResponse.json(
      { error: true, code: "GENERATE_ERROR", message: "Portrait generation failed" },
      { status: 500 },
    );
  }
}
