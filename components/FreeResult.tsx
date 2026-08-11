"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { PaywallBlock } from "./PaywallBlock";
import { RoastsList } from "./Card/RoastsList";
import { StatsGrid } from "./Card/StatsGrid";
import type { FreePortrait } from "@/lib/access/redact-portrait";
import type { TeaserProfile } from "@/lib/access/redact";
import type { Rarity, Roast } from "@/lib/llm/types";

/**
 * Страница разбора для того, кто ещё не заплатил.
 *
 * Отдельный компонент, а не ветка внутри ResultTabs, — намеренно. ResultTabs в
 * четырёх десятках мест читает поля полного профиля и полной карточки; общий
 * компонент на два режима означал бы, что в каждом режиме половина кода мёртвая,
 * и заводил бы ровно тот риск, от которого защищается вся затея: случайно
 * отрисовать платное поле. Здесь такого поля нет в типах — `FreePortrait` и
 * `TeaserProfile` их просто не содержат.
 */
interface FreeResultProps {
  free: FreePortrait;
  profile: TeaserProfile;
  steamId64: string;
  locale: string;
  /** Владение проверено на сервере (accountOwnsSteamId) — здесь только бейдж. */
  isOwner?: boolean;
}

const RARITY_BORDER: Record<Rarity, string> = {
  common: "border-gray-500",
  uncommon: "border-green-500",
  rare: "border-blue-500",
  epic: "border-purple-500",
  legendary: "border-yellow-500",
};

const RARITY_GLOW: Record<Rarity, string> = {
  common: "",
  uncommon: "shadow-green-500/20",
  rare: "shadow-blue-500/20",
  epic: "shadow-purple-500/20",
  legendary: "shadow-yellow-500/30 animate-pulse-glow",
};

const RARITY_GRADIENT: Record<Rarity, string> = {
  common: "from-gray-400 to-gray-500",
  uncommon: "from-green-400 to-emerald-500",
  rare: "from-blue-400 to-cyan-500",
  epic: "from-purple-400 to-pink-500",
  legendary: "from-yellow-400 to-amber-500",
};

const RARITY_BAR: Record<Rarity, string> = {
  common: "from-gray-500 to-gray-600",
  uncommon: "from-green-500 to-emerald-600",
  rare: "from-blue-500 to-cyan-600",
  epic: "from-purple-500 to-pink-600",
  legendary: "from-yellow-500 to-amber-600",
};

const RARITY_BADGE_BG: Record<Rarity, string> = {
  common: "bg-gray-800 text-gray-300",
  uncommon: "bg-green-900/50 text-green-300",
  rare: "bg-blue-900/50 text-blue-300",
  epic: "bg-purple-900/50 text-purple-300",
  legendary: "bg-yellow-900/50 text-yellow-300",
};

const STAT_KEYS = ["dedication", "mastery", "exploration", "hoarding", "social", "veteran"] as const;

/**
 * Ширины полосок в закрытой части. Список постоянный, а не случайный: случайные
 * числа дали бы разную вёрстку на сервере и в браузере, и React пожаловался бы
 * на расхождение. Считать их по настоящим цифрам нельзя — это и была бы утечка.
 */
const SKELETON_WIDTHS = ["72%", "48%", "84%", "36%", "60%"];

export function FreeResult({ free, profile, steamId64, locale, isOwner = false }: FreeResultProps) {
  const t = useTranslations();

  const rarity = free.rarity;
  const borderClass = RARITY_BORDER[rarity];
  const glowClass = RARITY_GLOW[rarity];
  const gradientClass = RARITY_GRADIENT[rarity];
  const barClass = RARITY_BAR[rarity];
  const badgeClass = RARITY_BADGE_BG[rarity];

  // Пояснений к шкалам здесь нет: они считаются по полному профилю, которого в
  // браузере без доступа нет и быть не должно. StatsGrid это допускает.
  const statItems = STAT_KEYS.map((key) => ({
    key,
    label: t(`stats.${key}`),
    value: free.stats[key],
  }));

  // Пустышке не хватает только `source` — в настоящем роасте он договаривает
  // как раз то, что спрятано, и потому в LockedRoast его нет вовсе. RoastsList
  // рисует источник только когда он есть, поэтому вёрстка совпадает точь-в-точь.
  const lockedAsRoasts: Roast[] = free.lockedRoasts.map((locked) => ({ ...locked, source: "" }));

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

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Карточка вердикта — настоящая, целиком бесплатная. Это то, чем делятся. */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className={`rounded-2xl border-2 ${borderClass} shadow-lg ${glowClass} bg-gray-950 overflow-hidden relative`}
        >
          {rarity === "legendary" && (
            <div className="absolute inset-0 z-0 animate-shimmer bg-gradient-to-r from-transparent via-yellow-500/5 to-transparent bg-[length:200%_100%] pointer-events-none" />
          )}

          <div className="relative z-10 p-5 sm:p-6 space-y-5">
            {/* Шапка. CardHeader здесь использовать нельзя: он на монтировании
                дёргает /api/art/generate, а арт платный и ответит отказом. */}
            <div className="flex items-start gap-4">
              <Image
                src={profile.player.avatar}
                alt={profile.player.name}
                width={72}
                height={72}
                className={`w-16 h-16 sm:w-[72px] sm:h-[72px] rounded-full border-2 ${borderClass} object-cover flex-shrink-0`}
                unoptimized
              />
              <div className="flex-1 min-w-0">
                <p className="text-gray-400 text-sm truncate">{profile.player.name}</p>
                {/* Название архетипа переносится, а не обрезается: оно приходит
                    от модели и на узком экране теряло бы последнее слово — ту
                    самую часть, ради которой карточку и открывают. */}
                <h1 className="font-cinzel text-lg sm:text-2xl font-bold leading-tight break-words">
                  <span className={`bg-gradient-to-r ${gradientClass} bg-clip-text text-transparent`}>
                    {free.primaryArchetype.name}
                  </span>
                </h1>
                <p className="text-gray-400 text-xs mt-0.5">{free.title}</p>
              </div>
              {/* На 320px эмодзи уступает место названию архетипа: имя важнее
                  украшения, и отнимать у него ширину нельзя. */}
              <span className="text-3xl sm:text-5xl flex-shrink-0" aria-hidden="true">
                {free.emoji}
              </span>
            </div>

            <div className="flex justify-end">
              <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${badgeClass}`}>
                {t(`result.rarity.${rarity}`)}
              </span>
            </div>

            <StatsGrid stats={statItems} barClass={barClass} gradientClass={gradientClass} />

            <div className="border-t border-gray-800 pt-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider">{t("result.spiritGame")}</p>
              <p className={`text-sm font-bold bg-gradient-to-r ${gradientClass} bg-clip-text text-transparent`}>
                {free.spirit_game}
              </p>
            </div>

            {/* Ровно один роаст — самый суровый. Пустой массив (карточка старой
                схемы из кеша) просто ничего не рисует, а не роняет страницу. */}
            {free.roasts.length > 0 && <RoastsList roasts={free.roasts} />}
          </div>
        </motion.div>

        {/* Витрина покупки стоит ПЕРЕД размытым, а не поверх него: оверлей на
            320px обрезал бы либо цену, либо дисклеймер, а читаемость здесь
            важнее приёма. */}
        <PaywallBlock steamId64={steamId64} locale={locale} lockedCount={free.lockedRoasts.length} />

        <div className="space-y-2">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold text-center">
            {t("paywall.lockedTitle")}
          </p>
          <p className="text-xs text-gray-600 text-center">{t("paywall.lockedHint")}</p>
        </div>

        {/*
          Размытие — оформление поверх пустышки, а не защита. Настоящих слов под
          ним нет: закрытый текст вырезан на сервере (lib/access/redact-portrait),
          а не спрятан оформлением, как было раньше.

          aria-hidden и pointer-events-none: читать бессмыслицу скринридеру и
          кликать по ней незачем.
        */}
        <div
          aria-hidden="true"
          className="blur-[5px] select-none pointer-events-none space-y-4 opacity-80"
        >
          <RoastsList roasts={lockedAsRoasts} />

          {/* Психопрофиль: пять шкал Big Five. */}
          <SkeletonCard>
            <div className="space-y-2">
              {SKELETON_WIDTHS.map((width, i) => (
                <div key={i} className="space-y-1">
                  <div className="h-2 rounded bg-gray-800" style={{ width: `${30 + i * 5}%` }} />
                  <div className="h-2 w-full rounded-full bg-gray-800">
                    <div className="h-2 rounded-full bg-gray-700" style={{ width }} />
                  </div>
                </div>
              ))}
            </div>
          </SkeletonCard>

          {/* Два теневых архетипа. */}
          <SkeletonCard>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[0, 1].map((i) => (
                <div key={i} className="rounded-lg bg-gray-800/60 p-3 space-y-2">
                  <div className="h-3 w-1/2 rounded bg-gray-700" />
                  <div className="h-2 w-full rounded bg-gray-800" />
                  <div className="h-2 w-4/5 rounded bg-gray-800" />
                </div>
              ))}
            </div>
          </SkeletonCard>

          {/* Дух-животное. */}
          <SkeletonCard>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gray-800 flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-1/3 rounded bg-gray-800" />
                <div className="h-2 w-4/5 rounded bg-gray-800" />
              </div>
            </div>
          </SkeletonCard>

          {/* AI-арт. */}
          <SkeletonCard>
            <div className="w-full rounded-lg bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900" style={{ paddingBottom: "60%" }} />
          </SkeletonCard>

          {/* Аналитика. */}
          <SkeletonCard>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="rounded-lg bg-gray-800/60 p-3 space-y-2">
                  <div className="h-4 w-2/3 rounded bg-gray-700" />
                  <div className="h-2 w-full rounded bg-gray-800" />
                </div>
              ))}
            </div>
          </SkeletonCard>
        </div>

        <p className="text-center text-xs text-gray-700">{t("footer.disclaimer")}</p>
      </div>
    </div>
  );
}

function SkeletonCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-gray-800 bg-gray-950 p-4">{children}</div>;
}
