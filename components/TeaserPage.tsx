"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import type { TeaserProfile } from "@/lib/access/redact";
import type { Rarity } from "@/lib/llm/types";

interface TeaserPageProps {
  /** Урезанная витрина, а не полный профиль — см. lib/access/redact. */
  profile: TeaserProfile;
  steamId64: string;
  locale: string;
  rarity: Rarity;
}

const RARITY_BORDER: Record<Rarity, string> = {
  common: "border-gray-500",
  uncommon: "border-green-500",
  rare: "border-blue-500",
  epic: "border-purple-500",
  legendary: "border-yellow-500",
};

const RARITY_BADGE_BG: Record<Rarity, string> = {
  common: "bg-gray-800 text-gray-300",
  uncommon: "bg-green-900/50 text-green-300",
  rare: "bg-blue-900/50 text-blue-300",
  epic: "bg-purple-900/50 text-purple-300",
  legendary: "bg-yellow-900/50 text-yellow-300",
};

const FEATURES = [
  { icon: "\uD83C\uDFAD", key: "feature1" },
  { icon: "\uD83E\uDDE0", key: "feature2" },
  { icon: "\uD83D\uDD25", key: "feature3" },
  { icon: "\uD83C\uDFA8", key: "feature4" },
  { icon: "\uD83D\uDCCA", key: "feature5" },
] as const;

export function TeaserPage({ profile, steamId64, locale, rarity }: TeaserPageProps) {
  const t = useTranslations();
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  // Не текст ошибки, а её ПРИЧИНА: от неё зависит, что предлагать делать.
  // Повтор помогает при отказе ИИ, но при протухших данных Steam он зациклит
  // посетителя на одном и том же отказе — там нужен новый разбор аккаунта.
  const [failure, setFailure] = useState<"" | "retryable" | "expired">("");
  // Одна генерация на монтирование: каждый лишний вызов — это платный запрос.
  const startedRef = useRef(false);

  const triggerGeneration = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setGenerating(true);
    setFailure("");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steamId64, locale }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFailure(data.code === "DATA_EXPIRED" ? "expired" : "retryable");
        setGenerating(false);
        startedRef.current = false; // Дать повторить после ошибки.
        return;
      }
      // Portrait generated — reload page to show full result
      router.refresh();
    } catch {
      setFailure("retryable");
      setGenerating(false);
      startedRef.current = false;
    }
  }, [steamId64, locale, router]);

  // Карточки ещё нет — запускаем генерацию сами и сразу, безо всяких условий:
  // генерация бесплатна (платной является только часть готовой карточки), а
  // сюда страница присылает ровно тех, у кого портрета нет. Раньше запуск
  // стоял за флагом доступа, и при включённой кассе посетитель без права
  // застревал на витрине навсегда — не увидев ни карточки, ни кнопки.
  //
  // Именно в эффекте, а не в теле отрисовки: прежний автозапуск стоял в теле
  // и мог сработать несколько раз за один рендер — каждый раз оплачиваемым
  // вызовом. startedRef внутри triggerGeneration страхует от повтора, в том
  // числе от двойного прогона эффектов в строгом режиме разработки.
  useEffect(() => {
    // Каскадный рендер тут — не побочный эффект, а сама цель: сразу показываем
    // крутилку и уходим в сеть за генерацией, вместо лишнего кадра с витриной.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    triggerGeneration();
  }, [triggerGeneration]);

  const borderClass = RARITY_BORDER[rarity];
  const badgeClass = RARITY_BADGE_BG[rarity];

  // Generating state
  if (generating) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-4 max-w-sm"
        >
          <div className="relative w-20 h-20 mx-auto">
            <div className="absolute inset-0 rounded-full border-4 border-purple-500/30" />
            <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-purple-500 animate-spin" />
            <Image
              src={profile.player.avatar}
              alt=""
              width={64}
              height={64}
              className="absolute inset-2 rounded-full object-cover"
              unoptimized
            />
          </div>
          <h2 className="text-xl font-bold text-white">{t("teaser.generating")}</h2>
          <p className="text-gray-400 text-sm">{t("teaser.generatingHint")}</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/*
          Отказ генерации показывается ЗДЕСЬ, а не только внутри крутилки.
          Раньше текст ошибки жил в ветке `generating`, которую этот же код
          гасит вместе с записью ошибки, — то есть увидеть его было нельзя
          никогда. Посетитель получал витрину «что тебя ждёт» вместо карточки
          и никакого объяснения: ровно так выглядел сбой моста 2026-08-11.
        */}
        {failure && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            role="alert"
            className="rounded-2xl border border-red-500/40 bg-red-950/40 p-5 space-y-3 text-center"
          >
            <h2 className="text-lg font-bold text-red-200">
              {t(failure === "expired" ? "teaser.expired" : "teaser.failed")}
            </h2>
            <p className="text-sm text-red-200/70">
              {t(failure === "expired" ? "teaser.expiredHint" : "teaser.failedHint")}
            </p>
            {failure === "expired" ? (
              <Link
                href={`/${locale}`}
                className="inline-block px-5 py-2.5 rounded-lg bg-red-500 hover:bg-red-400 text-white text-sm font-semibold transition-colors"
              >
                {t("teaser.reanalyze")}
              </Link>
            ) : (
              <button
                onClick={triggerGeneration}
                className="px-5 py-2.5 rounded-lg bg-red-500 hover:bg-red-400 text-white text-sm font-semibold transition-colors"
              >
                {t("teaser.retry")}
              </button>
            )}
          </motion.div>
        )}

        {/* Profile card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className={`rounded-2xl border-2 ${borderClass} bg-gray-950 overflow-hidden`}
        >
          {/* Header with avatar */}
          <div className="p-6 flex flex-col items-center text-center space-y-4">
            <div className="relative">
              <Image
                src={profile.player.avatar}
                alt={profile.player.name}
                width={96}
                height={96}
                className={`w-24 h-24 rounded-full border-3 ${borderClass} object-cover`}
                unoptimized
              />
              <div className="absolute -bottom-1 -right-1">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${badgeClass}`}>
                  {t(`result.rarity.${rarity}`)}
                </span>
              </div>
            </div>

            <h1 className="text-2xl font-bold text-white truncate max-w-full">
              {profile.player.name}
            </h1>

            {/* Quick stats */}
            <div className="flex flex-wrap justify-center gap-4 text-sm">
              <div className="bg-gray-900 rounded-lg px-4 py-2 text-center">
                <p className="text-lg font-bold text-white font-mono">{profile.stats.totalGames}</p>
                <p className="text-xs text-gray-500">{t("teaser.games")}</p>
              </div>
              <div className="bg-gray-900 rounded-lg px-4 py-2 text-center">
                <p className="text-lg font-bold text-white font-mono">{profile.stats.totalPlaytimeHours}</p>
                <p className="text-xs text-gray-500">{t("teaser.hours")}</p>
              </div>
              <div className="bg-gray-900 rounded-lg px-4 py-2 text-center">
                <p className="text-lg font-bold text-white font-mono">{profile.player.steamLevel}</p>
                <p className="text-xs text-gray-500">{t("teaser.level")}</p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* What awaits */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="rounded-2xl bg-gray-900/80 backdrop-blur-sm border border-gray-800 p-6 space-y-4"
        >
          <h2 className="text-xl font-bold text-center bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
            {t("teaser.title")}
          </h2>
          <p className="text-gray-400 text-center text-sm">
            {t("teaser.subtitle")}
          </p>

          <div className="space-y-3 pt-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
              {t("teaser.whatAwaits")}
            </p>
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.key}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.08 }}
                className="flex items-center gap-3 bg-gray-800/50 rounded-lg px-4 py-3"
              >
                <span className="text-xl flex-shrink-0">{f.icon}</span>
                <span className="text-sm text-gray-200">{t(`teaser.${f.key}`)}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/*
          Здесь стоял замок «подпишись на Telegram-канал». Гейт на подписку
          отменён как способ открыть разбор (решение владельца 2026-08-10):
          второй бесплатный путь означал бы, что платить незачем. Кнопки
          покупки здесь нет намеренно: пока карточки не существует, покупать
          нечего — витрина покупки живёт на готовом разборе (FreeResult).
        */}
      </div>
    </div>
  );
}
