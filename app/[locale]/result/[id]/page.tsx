import { getCache, setCache } from "@/lib/cache/redis";
import { portraitKey, profileKey, cardStatsKey, rarityKey, CACHE_TTL } from "@/lib/cache/keys";
import type { CardPortrait, Rarity } from "@/lib/llm/types";
import type { AggregatedProfile } from "@/lib/aggregation/types";
import type { CardStats } from "@/lib/aggregation/aggregate";
import { translatePortrait } from "@/lib/llm/translate";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { ShareButtons } from "@/components/ShareButtons";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { ResultTabs } from "@/components/ResultTabs";
import { TeaserPage } from "@/components/TeaserPage";
import { getAccessLevel } from "@/lib/access/entitlement";
import { toTeaserProfile } from "@/lib/access/redact";
import { toFreePortrait } from "@/lib/access/redact-portrait";
import { getCurrentAccountId } from "@/lib/identity/session";
import { accountOwnsSteamId } from "@/lib/identity/store";
import { SITE_URL, SITE_NAME } from "@/lib/site";

interface Props {
  // В Next 15+ параметры маршрута приходят промисом.
  params: Promise<{ id: string; locale: string }>;
}

export async function generateMetadata({ params: rawParams }: Props): Promise<Metadata> {
  const params = await rawParams;
  const portrait = await getCache<CardPortrait>(portraitKey(params.id, params.locale));
  const profile = await getCache<AggregatedProfile>(profileKey(params.id));

  if (!portrait || !profile) {
    return { title: SITE_NAME };
  }

  const title = `${profile.player.name} — "${portrait.primaryArchetype.name}" | ${SITE_NAME}`;

  // Цитата — платная часть карточки, а описание страницы попадает в исходник
  // всем подряд, включая тех, кто разбор не открывал: заголовок страницы читается
  // без всякого CSS. Без доступа описанием работает бесплатный вердикт — самый
  // суровый роаст, то самое, чем и делятся.
  const access = await getAccessLevel(params.id);
  const description =
    access === "full" ? portrait.quote : (toFreePortrait(portrait).roasts[0]?.text ?? portrait.title);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [`${SITE_URL}/${params.locale}/result/${params.id}/opengraph-image`],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function ResultPage({ params: rawParams }: Props) {
  const params = await rawParams;
  const t = await getTranslations();
  let portrait = await getCache<CardPortrait>(portraitKey(params.id, params.locale));
  const profile = await getCache<AggregatedProfile>(profileKey(params.id));

  // Решение о доступе принимает сервер. Пока доступа нет, ни портрет, ни полный
  // профиль в браузер не уезжают — раньше они уходили целиком и лишь размывались.
  const access = await getAccessLevel(params.id);

  // Владение доказывает ТОЛЬКО подтверждённая привязка Steam. Вход через
  // Telegram или любая ошибка здесь означают «не владелец» — ошибка не
  // повышает права, только понижает. Обещание держит сам слой личности:
  // недоступная база отдаёт false (lib/identity/db.ts), а не исключение,
  // иначе беда с базой превращалась бы в 500 на главной странице продукта.
  const currentAccountId = await getCurrentAccountId();
  const isOwner = currentAccountId ? accountOwnsSteamId(currentAccountId, params.id) : false;

  if (access !== "full" && profile) {
    // Единственная дверь наружу без доступа: платного текста в этом объекте уже
    // нет — не «размыт», а отсутствует (lib/access/redact-portrait). Сегодня
    // витрина берёт отсюда только редкость; сами блоки карточки с пустышками
    // под размытием подключает следующая задача плана.
    const free = portrait ? toFreePortrait(portrait) : null;
    // Редкость карточки надёжнее отдельного кеша: он живёт меньше портрета, и
    // после его протухания витрина показывала бы «common» на легендарной карте.
    const cachedRarity = await getCache<Rarity>(rarityKey(params.id));
    return (
      <div className="min-h-screen">
        <div className="absolute top-4 right-4 z-30 flex items-center gap-2">
          {isOwner && (
            <span className="px-3 py-1 rounded-full bg-green-500/20 text-green-300 text-xs font-semibold">
              {t("result.yourProfile")}
            </span>
          )}
          <LocaleSwitcher />
        </div>
        <TeaserPage
          profile={toTeaserProfile(profile)}
          steamId64={params.id}
          locale={params.locale}
          rarity={free?.rarity ?? cachedRarity ?? "common"}
        />
      </div>
    );
  }

  // Доступ есть, но портрет ещё не сгенерирован — показываем ту же витрину,
  // она сама запустит генерацию.
  if (!portrait && profile) {
    const cachedStats = await getCache<CardStats>(cardStatsKey(params.id));
    const cachedRarity = await getCache<Rarity>(rarityKey(params.id));
    if (cachedStats && cachedRarity) {
      return (
        <div className="min-h-screen">
          <div className="absolute top-4 right-4 z-30 flex items-center gap-2">
            {isOwner && (
              <span className="px-3 py-1 rounded-full bg-green-500/20 text-green-300 text-xs font-semibold">
                {t("result.yourProfile")}
              </span>
            )}
            <LocaleSwitcher />
          </div>
          <TeaserPage
            profile={toTeaserProfile(profile)}
            steamId64={params.id}
            locale={params.locale}
            rarity={cachedRarity}
            /* Сюда попадаем только когда доступ уже разрешён (ветка выше
               перехватывает отсутствие доступа). Значит замок рисовать
               нельзя — витрина здесь работает как экран ожидания. */
            accessGranted
          />
        </div>
      );
    }

    // Fallback: translate from other locale instead of showing "expired"
    const otherLocale = params.locale === "ru" ? "en" : "ru";
    const otherPortrait = await getCache<CardPortrait>(portraitKey(params.id, otherLocale));
    if (otherPortrait) {
      portrait = await translatePortrait(otherPortrait, otherLocale, params.locale);
      if (portrait) {
        await setCache(portraitKey(params.id, params.locale), portrait, CACHE_TTL.portrait);
      }
    }
  }

  if (!portrait || !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="text-center space-y-4">
          <p className="text-xl text-gray-300">{t("errors.expired")}</p>
          <a
            href={`/${params.locale}`}
            className="inline-block px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            {t("errors.retry")}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Переключатель языка отрисовывает сама панель вкладок: отдельным
          плавающим блоком он накрывал правую вкладку, и на телефоне нажать её
          было нельзя. Бейдж владельца едет тем же путём, рядом с ним. */}
      <ResultTabs
        portrait={portrait}
        profile={profile}
        steamId64={params.id}
        locale={params.locale}
        isOwner={isOwner}
      />

      {/* Actions */}
      <div className="max-w-3xl mx-auto px-4 pb-8 space-y-6">
        <ShareButtons
          steamId64={params.id}
          archetype={portrait.primaryArchetype.name}
          rarity={portrait.rarity}
          emoji={portrait.emoji}
          locale={params.locale}
        />

        <div className="text-center">
          <span
            className="inline-block px-8 py-3 bg-gray-700 text-gray-400 font-semibold rounded-xl cursor-not-allowed"
          >
            {t("result.challengeFriend")} — {t("result.inDevelopment")}
          </span>
        </div>

        <p className="text-center text-xs text-gray-700">{t("footer.disclaimer")}</p>
      </div>
    </div>
  );
}
