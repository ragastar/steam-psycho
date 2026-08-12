import { NextResponse } from "next/server";
import { generatePortrait } from "@/lib/llm/client";
import { applyComputedFacts } from "@/lib/llm/facts";
import { getCache, setCache, deleteCache, incrementRateLimit } from "@/lib/cache/redis";
import { persistPurchased } from "@/lib/cache/purchased";
import { steamIdHasEntitlement } from "@/lib/billing/store";
import { paywallMode } from "@/lib/access/entitlement";
import { CACHE_TTL, portraitKey, profileKey, cardStatsKey, rarityKey, rateLimitKey } from "@/lib/cache/keys";
import { ensureCardIdentity } from "@/lib/art/identity-store";
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

    // Генерация уходит в фон, а ответ отдаётся сразу.
    //
    // Держать соединение открытым было нельзя: карточка пишется 85-120 секунд
    // при потолке попытки 160 и общем сроке 165, переспрос при неразобранном
    // ответе требует запаса в сто секунд — то есть запасной попытки фактически
    // не существовало, и любая осечка модели превращалась в отказ человеку.
    // Плюс nginx рвёт соединение на 180 секундах, а платный ключ в этот срок
    // не влезал бы вовсе.
    //
    // Замок не даёт запустить вторую генерацию того же человека: каждая стоит
    // денег. Живёт пять минут — дольше генерация не длится ни при каких сроках,
    // и зависший замок сам отпустит.
    if (await getCache(genLockKey(steamId64, locale))) {
      return NextResponse.json({ status: "pending" });
    }
    await setCache(genLockKey(steamId64, locale), true, GEN_LOCK_TTL);
    await deleteCache(genFailKey(steamId64, locale));

    // Намеренно без await: процесс живёт дальше ответа (это долгоживущий
    // сервер, а не разовая функция), и результат подхватит опрос состояния.
    void runGeneration({ steamId64, locale, profile, cardStats, rarity, ipHash }).catch((err) => {
      console.error("[generate] фоновая генерация упала:", err);
    });

    return NextResponse.json({ status: "pending" });
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

/**
 * Состояние генерации. Опрашивается страницей ожидания.
 *
 * `idle` — никто не начинал; `pending` — идёт; `ready` — карточка готова;
 * `failed` — не получилось, и повторить можно.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const steamId64 = url.searchParams.get("steamId64") || "";
  const locale = url.searchParams.get("locale") || "ru";

  if (!/^\d{17}$/.test(steamId64)) {
    return NextResponse.json({ error: true, code: "INVALID_INPUT" }, { status: 400 });
  }

  if (await getCache(portraitKey(steamId64, locale))) {
    return NextResponse.json({ status: "ready" });
  }

  const failure = await getCache<{ code: string }>(genFailKey(steamId64, locale));
  if (failure) return NextResponse.json({ status: "failed", code: failure.code });

  if (await getCache(genLockKey(steamId64, locale))) {
    return NextResponse.json({ status: "pending" });
  }

  return NextResponse.json({ status: "idle" });
}

/** Замок и след отказа. В SQLite не уезжают: оба живут минутами. */
const GEN_LOCK_TTL = 300;
const GEN_FAIL_TTL = 120;

function genLockKey(steamId64: string, locale: string): string {
  return `genlock:v1:${steamId64}:${locale}`;
}

function genFailKey(steamId64: string, locale: string): string {
  return `genfail:v1:${steamId64}:${locale}`;
}

/**
 * Сама генерация. Работает уже после того, как ответ ушёл человеку, поэтому
 * обязана убрать за собой замок в любом исходе — иначе следующая попытка
 * упрётся в него на пять минут.
 */
async function runGeneration(args: {
  steamId64: string;
  locale: string;
  profile: AggregatedProfile;
  cardStats: CardStats;
  rarity: Rarity;
  ipHash: string;
}): Promise<void> {
  const { steamId64, locale, profile, cardStats, rarity, ipHash } = args;
  try {
    // 3. Generate portrait via LLM
    //
    // Личность карточки (класс существа, стихия, свет) читается ДО генерации:
    // класс уезжает в промпт обязательным ограничением. Без него модель
    // сваливается в свой самый вероятный образ — из пятнадцати духов восемь
    // выходили грызунами. Раньше эта строка стояла ПОСЛЕ генерации и служила
    // только аналитике.
    const cardIdentity = await ensureCardIdentity(profile, cardStats, steamId64);

    const t0 = Date.now();
    const generated = await generatePortrait(profile, cardStats, rarity, cardIdentity, locale);
    const u = generated.usage;
    const usageNote = u
      ? ` ввод ${u.input} (из кеша ${u.cachedInput}), вывод ${u.output}`
      : "";
    console.log(
      `[generate] ${steamId64} LLM: ${Date.now() - t0}ms (${generated.provider}/${generated.model})${usageNote}`,
    );

    // Числа берём свои: модель регулярно перевирает статы, которые ей дали.
    const portrait = applyComputedFacts(generated.portrait, cardStats, rarity);

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
  } catch (err) {
    console.error("[generate] генерация не удалась:", err);
    logError({
      type: "GENERATE_ERROR",
      message: err instanceof Error ? err.message : "Unknown",
      ipHash,
      endpoint: "/api/generate",
    });
    // Замок снимается ПЕРЕД тем, как выставить след отказа. Иначе опрос видит
    // «не получилось» раньше, чем можно повторить, и кнопка «попробовать ещё»
    // упирается в замок, которого человек не видит.
    await deleteCache(genLockKey(steamId64, locale));
    await setCache(genFailKey(steamId64, locale), { code: "GENERATE_ERROR" }, GEN_FAIL_TTL);
  } finally {
    // Подстраховка на случай неожиданного выхода: снимать дважды безвредно.
    await deleteCache(genLockKey(steamId64, locale));
  }
}
