import { getCache } from "@/lib/cache/redis";
import { portraitKey, profileKey } from "@/lib/cache/keys";
import type { CardPortrait } from "@/lib/llm/types";
import type { AggregatedProfile } from "@/lib/aggregation/types";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { ShareButtons } from "@/components/ShareButtons";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { ResultTabs } from "@/components/ResultTabs";

interface Props {
  params: { id: string; locale: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const portrait = await getCache<CardPortrait>(portraitKey(params.id, params.locale));
  const profile = await getCache<AggregatedProfile>(profileKey(params.id));
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

  if (!portrait || !profile) {
    return { title: "GamerType" };
  }

  const title = `${profile.player.name} — "${portrait.primaryArchetype.name}" | GamerType`;
  const description = portrait.quote;

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
  const portrait = await getCache<CardPortrait>(portraitKey(params.id, params.locale));
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
    <div className="min-h-screen">
      <div className="absolute top-4 right-4 z-30">
        <LocaleSwitcher />
      </div>

      <ResultTabs
        portrait={portrait}
        profile={profile}
        steamId64={params.id}
        locale={params.locale}
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
          <a
            href={`/${params.locale}`}
            className="inline-block px-8 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-xl hover:opacity-90 transition-all shadow-lg"
          >
            {t("result.challengeFriend")}
          </a>
        </div>

        <p className="text-center text-xs text-gray-700">{t("footer.disclaimer")}</p>
      </div>
    </div>
  );
}
