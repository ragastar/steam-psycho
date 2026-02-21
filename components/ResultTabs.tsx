"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { TabNavigation, TabContainer } from "./TabNavigation";
import { CardHeader } from "./Card/CardHeader";
import { StatsGrid } from "./Card/StatsGrid";
import { ArchetypeBadges } from "./Card/ArchetypeBadges";
import { RoastsList } from "./Card/RoastsList";
import { TopGamesCompact } from "./Card/TopGamesCompact";
import { EconomicsCard } from "./DeepDive/EconomicsCard";
import { AchievementsCard } from "./DeepDive/AchievementsCard";
import { PlatformsBar } from "./DeepDive/PlatformsBar";
import { TimelineCard } from "./DeepDive/TimelineCard";
import { SocialCard } from "./DeepDive/SocialCard";
import { PatternsGrid } from "./DeepDive/PatternsGrid";
import { RanksCard } from "./DeepDive/RanksCard";
import { BadgesCard } from "./DeepDive/BadgesCard";
import { TelegramGate } from "./TelegramGate";
import type { CardPortrait, Rarity } from "@/lib/llm/types";
import type { AggregatedProfile } from "@/lib/aggregation/types";

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

interface ResultTabsProps {
  portrait: CardPortrait;
  profile: AggregatedProfile;
  steamId64: string;
  locale: string;
}

export function ResultTabs({ portrait, profile, steamId64, locale }: ResultTabsProps) {
  const t = useTranslations();
  const [activeTab, setActiveTab] = useState("card");

  const rarity = portrait.rarity;
  const borderClass = RARITY_BORDER[rarity];
  const glowClass = RARITY_GLOW[rarity];
  const gradientClass = RARITY_GRADIENT[rarity];
  const barClass = RARITY_BAR[rarity];
  const badgeClass = RARITY_BADGE_BG[rarity];

  const tabs = [
    { id: "card", label: t("tabs.card"), icon: "🃏" },
    { id: "deepdive", label: t("tabs.deepDive"), icon: "🔍" },
  ];

  const statItems = [
    { key: "dedication", label: t("stats.dedication"), value: portrait.stats.dedication },
    { key: "mastery", label: t("stats.mastery"), value: portrait.stats.mastery },
    { key: "exploration", label: t("stats.exploration"), value: portrait.stats.exploration },
    { key: "hoarding", label: t("stats.hoarding"), value: portrait.stats.hoarding },
    { key: "social", label: t("stats.social"), value: portrait.stats.social },
    { key: "veteran", label: t("stats.veteran"), value: portrait.stats.veteran },
  ];

  return (
    <div>
      <TabNavigation tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="max-w-3xl mx-auto px-4 py-6">
        <TabContainer activeTab={activeTab}>
          {activeTab === "card" && (
            <div className="space-y-6">
              {/* Card */}
              <div className={`rounded-2xl border-2 ${borderClass} shadow-lg ${glowClass} bg-gray-950 overflow-hidden relative`}>
                {/* Shimmer overlay for legendary */}
                {rarity === "legendary" && (
                  <div className="absolute inset-0 z-0 animate-shimmer bg-gradient-to-r from-transparent via-yellow-500/5 to-transparent bg-[length:200%_100%] pointer-events-none" />
                )}

                <CardHeader
                  portrait={portrait}
                  profile={profile}
                  rarityGradient={gradientClass}
                  rarityBorder={borderClass}
                  steamId64={steamId64}
                  locale={locale}
                />

                <div className="px-6 pb-6 space-y-5 relative z-10">
                  {/* Rarity badge */}
                  <div className="flex justify-end">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${badgeClass}`}>
                      {t(`result.rarity.${rarity}`)}
                    </span>
                  </div>

                  {/* 3 Archetype badges */}
                  <ArchetypeBadges
                    primary={portrait.primaryArchetype}
                    secondary={portrait.secondaryArchetype}
                    shadow={portrait.shadowArchetype}
                    labels={{
                      primary: t("archetypes.primary"),
                      secondary: t("archetypes.secondary"),
                      shadow: t("archetypes.shadow"),
                    }}
                  />

                  {/* 6 Stats */}
                  <StatsGrid stats={statItems} barClass={barClass} gradientClass={gradientClass} />

                  {/* Quote */}
                  <div className="text-center italic text-gray-300 border-t border-gray-800 pt-4">
                    &ldquo;{portrait.quote}&rdquo;
                  </div>

                  {/* Lore */}
                  <p className="text-sm text-gray-400 leading-relaxed">{portrait.lore}</p>

                  {/* Roasts in TelegramGate */}
                  <TelegramGate steamId64={steamId64} locale={locale}>
                    <div className="space-y-4">
                      <RoastsList roasts={portrait.roasts} />
                    </div>
                  </TelegramGate>

                  {/* Top 5 Games */}
                  <section>
                    <h2 className="text-sm font-semibold text-gray-300 mb-2">{t("result.topGames")}</h2>
                    <TopGamesCompact games={profile.topGames} barClass={barClass} />
                  </section>

                  {/* 3 Metric cards */}
                  <div className="grid grid-cols-3 gap-3">
                    <MetricCard
                      label={t("result.totalGames")}
                      value={String(profile.stats.totalGames)}
                      sub={`Top ${100 - profile.ranks.librarySizePercentile}%`}
                    />
                    <MetricCard
                      label={t("result.totalHours")}
                      value={String(profile.stats.totalPlaytimeHours)}
                      sub={`Top ${100 - profile.ranks.hoursPercentile}%`}
                    />
                    <MetricCard
                      label={t("result.steamLevel")}
                      value={String(profile.player.steamLevel)}
                    />
                  </div>

                  {/* Spirit bar */}
                  <div className="flex items-center gap-4 border-t border-gray-800 pt-4">
                    <div className="flex-1">
                      <p className="text-xs text-gray-500 uppercase tracking-wider">{t("result.spiritGame")}</p>
                      <p className={`text-sm font-bold bg-gradient-to-r ${gradientClass} bg-clip-text text-transparent`}>
                        {portrait.spirit_game}
                      </p>
                    </div>
                    <div className="flex-1 text-right">
                      <p className="text-xs text-gray-500 uppercase tracking-wider">{t("result.spiritAnimal")}</p>
                      <p className="text-sm text-gray-300">
                        {portrait.spirit_animal.name}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "deepdive" && (
            <TelegramGate steamId64={steamId64} locale={locale}>
              <div className="space-y-4">
                <EconomicsCard
                  economics={profile.economics}
                  labels={{
                    title: t("deepDive.economics.title"),
                    libraryValue: t("deepDive.economics.libraryValue"),
                    wasted: t("deepDive.economics.wasted"),
                    perHour: t("deepDive.economics.perHour"),
                    bestDeal: t("deepDive.economics.bestDeal"),
                    freeGames: t("deepDive.economics.freeGames"),
                  }}
                />
                <AchievementsCard
                  achievements={profile.achievements}
                  labels={{
                    title: t("deepDive.achievements.title"),
                    completion: t("deepDive.achievements.completion"),
                    rarest: t("deepDive.achievements.rarest"),
                    noData: t("deepDive.achievements.noData"),
                  }}
                />
                <PlatformsBar
                  platforms={profile.platforms}
                  labels={{
                    title: t("deepDive.platforms.title"),
                    windows: "Windows",
                    linux: "Linux",
                    deck: "Steam Deck",
                  }}
                />
                <TimelineCard
                  timeline={profile.timeline}
                  labels={{
                    title: t("deepDive.timeline.title"),
                    accountAge: t("deepDive.timeline.accountAge"),
                    currentMonthly: t("deepDive.timeline.currentMonthly"),
                    trend: t("deepDive.timeline.trend"),
                    lastActive: t("deepDive.timeline.lastActive"),
                    years: t("deepDive.timeline.years"),
                    hours: t("deepDive.timeline.hours"),
                    trendRising: t("deepDive.timeline.trendRising"),
                    trendStable: t("deepDive.timeline.trendStable"),
                    trendDeclining: t("deepDive.timeline.trendDeclining"),
                    trendInactive: t("deepDive.timeline.trendInactive"),
                  }}
                />
                <SocialCard
                  social={profile.social}
                  labels={{
                    title: t("deepDive.social.title"),
                    friends: t("deepDive.social.friends"),
                    perYear: t("deepDive.social.perYear"),
                    oldestFriend: t("deepDive.social.oldestFriend"),
                    noData: t("deepDive.social.noData"),
                  }}
                />
                <PatternsGrid
                  patterns={profile.patterns}
                  labels={{
                    title: t("deepDive.patterns.title"),
                    genreConcentration: t("deepDive.patterns.genreConcentration"),
                    bingeStyle: t("deepDive.patterns.bingeStyle"),
                    indieGames: t("deepDive.patterns.indieGames"),
                    binger: t("deepDive.patterns.binger"),
                    sampler: t("deepDive.patterns.sampler"),
                    balanced: t("deepDive.patterns.balanced"),
                  }}
                />
                <RanksCard
                  ranks={profile.ranks}
                  labels={{
                    title: t("deepDive.ranks.title"),
                    hours: t("deepDive.ranks.hours"),
                    library: t("deepDive.ranks.library"),
                    concentration: t("deepDive.ranks.concentration"),
                    veteran: t("deepDive.ranks.veteran"),
                  }}
                />
                <BadgesCard
                  badges={profile.badges}
                  labels={{
                    title: t("deepDive.badges.title"),
                    total: t("deepDive.badges.total"),
                    xp: t("deepDive.badges.xp"),
                    rarest: t("deepDive.badges.rarest"),
                    noData: t("deepDive.badges.noData"),
                  }}
                />
              </div>
            </TelegramGate>
          )}
        </TabContainer>
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-gray-900 rounded-lg p-3 text-center">
      <p className="text-xl font-bold text-white font-mono">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
      {sub && <p className="text-[10px] text-gray-600 font-mono">{sub}</p>}
    </div>
  );
}
