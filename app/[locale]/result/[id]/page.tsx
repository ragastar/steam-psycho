import Image from "next/image";
import { getCache } from "@/lib/cache/redis";
import { portraitKey, profileKey } from "@/lib/cache/keys";
import type { Portrait } from "@/lib/llm/types";
import type { AggregatedProfile } from "@/lib/aggregation/types";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { ShareButtons } from "@/components/ShareButtons";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

interface Props {
  params: { id: string; locale: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const portrait = await getCache<Portrait>(portraitKey(params.id, params.locale));
  const profile = await getCache<AggregatedProfile>(profileKey(params.id));
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

  if (!portrait || !profile) {
    return { title: "Steam Psycho" };
  }

  const title = `${profile.player.name} — "${portrait.archetype}" | Steam Psycho`;
  const description = portrait.shortBio;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [`${baseUrl}/${params.locale}/result/${params.id}/opengraph-image`],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function ResultPage({ params }: Props) {
  const t = await getTranslations();
  const portrait = await getCache<Portrait>(portraitKey(params.id, params.locale));
  const profile = await getCache<AggregatedProfile>(profileKey(params.id));

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
    <div className="min-h-screen py-8 px-4">
      <div className="absolute top-4 right-4">
        <LocaleSwitcher />
      </div>

      <div className="max-w-3xl mx-auto space-y-8">
        {/* Hero */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-4">
            <Image
              src={profile.player.avatar}
              alt={profile.player.name}
              width={80}
              height={80}
              className="rounded-full border-2 border-purple-500"
            />
            <div className="text-left">
              <p className="text-gray-400 text-sm">{profile.player.name}</p>
              <h1 className="text-3xl sm:text-4xl font-bold">
                <span className="mr-2">{portrait.archetypeEmoji}</span>
                <span className="bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
                  {portrait.archetype}
                </span>
              </h1>
            </div>
          </div>
          <p className="text-lg text-gray-300 max-w-xl mx-auto">{portrait.shortBio}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label={t("result.totalGames")} value={String(profile.stats.totalGames)} />
          <StatCard label={t("result.totalHours")} value={String(profile.stats.totalPlaytimeHours)} />
          <StatCard label={t("result.concentration")} value={`${profile.concentrationRatio}%`} />
          <StatCard label="MP/SP" value={`${profile.multiplayerRatio}/${profile.singleplayerRatio}`} />
        </div>

        {/* Traits */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t("result.traits")}</h2>
          <div className="space-y-2">
            {portrait.traits.map((trait) => (
              <div key={trait.name} className="bg-gray-900 rounded-lg p-4">
                <div className="flex justify-between mb-1">
                  <span className="font-medium">{trait.name}</span>
                  <span className="text-purple-400">{trait.score}/100</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-2 mb-2">
                  <div
                    className="bg-gradient-to-r from-purple-500 to-pink-500 rounded-full h-2 transition-all"
                    style={{ width: `${trait.score}%` }}
                  />
                </div>
                <p className="text-sm text-gray-400">{trait.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Deep Dive */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t("result.deepDive")}</h2>
          <div className="bg-gray-900 rounded-lg p-6 text-gray-300 leading-relaxed whitespace-pre-line">
            {portrait.deepDive}
          </div>
        </section>

        {/* Top Genres */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t("result.topGenres")}</h2>
          <div className="space-y-2">
            {profile.genreDistribution.slice(0, 6).map((g) => (
              <div key={g.genre} className="flex items-center gap-3">
                <span className="w-24 text-sm text-gray-400 text-right">{g.genre}</span>
                <div className="flex-1 bg-gray-800 rounded-full h-3">
                  <div
                    className="bg-gradient-to-r from-purple-600 to-pink-600 rounded-full h-3"
                    style={{ width: `${g.percentage}%` }}
                  />
                </div>
                <span className="text-sm text-gray-400 w-10">{g.percentage}%</span>
              </div>
            ))}
          </div>
        </section>

        {/* Spirit Game */}
        <section className="bg-gray-900 rounded-lg p-6 space-y-2">
          <h2 className="text-xl font-semibold">{t("result.spiritGame")}</h2>
          <p className="text-2xl font-bold text-purple-400">{portrait.spiritGame.name}</p>
          <p className="text-gray-400">{t("result.because")}: {portrait.spiritGame.reason}</p>
        </section>

        {/* Fun Facts + Toxic Trait */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="bg-gray-900 rounded-lg p-6 space-y-3">
            <h2 className="text-xl font-semibold">{t("result.funFacts")}</h2>
            <ul className="space-y-2">
              {portrait.funFacts.map((fact, i) => (
                <li key={i} className="text-gray-300 flex gap-2">
                  <span className="text-purple-400">•</span>
                  {fact}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-gray-900 rounded-lg p-6 space-y-3">
            <h2 className="text-xl font-semibold text-red-400">{t("result.toxicTrait")}</h2>
            <p className="text-gray-300">{portrait.toxicTrait}</p>
            <div className="pt-4 border-t border-gray-800">
              <h3 className="font-semibold text-green-400">{t("result.recommendation")}</h3>
              <p className="text-gray-300 mt-1">{portrait.recommendation}</p>
            </div>
          </div>
        </div>

        {/* Share */}
        <ShareButtons steamId64={params.id} />

        {/* Check Friend */}
        <div className="text-center">
          <a
            href={`/${params.locale}`}
            className="inline-block px-6 py-3 border border-purple-500 text-purple-400 rounded-lg hover:bg-purple-500/10 transition-colors"
          >
            {t("result.checkFriend")}
          </a>
        </div>

        {/* Disclaimer */}
        <p className="text-center text-xs text-gray-700">{t("footer.disclaimer")}</p>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-900 rounded-lg p-4 text-center">
      <p className="text-2xl font-bold text-purple-400">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  );
}
