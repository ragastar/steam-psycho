/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text */
import { ImageResponse } from "next/og";
import { getCache } from "@/lib/cache/redis";
import { portraitKey, profileKey } from "@/lib/cache/keys";
import type { Portrait } from "@/lib/llm/types";
import type { AggregatedProfile } from "@/lib/aggregation/types";

export const runtime = "nodejs";
export const alt = "Steam Psycho Profile";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: { id: string; locale: string } }) {
  const portrait = await getCache<Portrait>(portraitKey(params.id, params.locale));
  const profile = await getCache<AggregatedProfile>(profileKey(params.id));

  if (!portrait || !profile) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#0f0f1a",
            color: "#fff",
            fontSize: 48,
          }}
        >
          Steam Psycho
        </div>
      ),
      { ...size },
    );
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "48px 56px",
          background: "linear-gradient(135deg, #0f0f1a, #1a0f2e)",
          color: "#fff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          <img
            src={profile.player.avatar}
            width={80}
            height={80}
            style={{ borderRadius: "50%", border: "3px solid #a855f7" }}
          />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: "20px", color: "#999" }}>{profile.player.name}</div>
            <div style={{ fontSize: "40px", fontWeight: 700, color: "#a855f7" }}>
              {portrait.archetypeEmoji} {portrait.archetype}
            </div>
          </div>
        </div>
        <div style={{ fontSize: "20px", color: "#ccc", lineHeight: 1.5 }}>
          {portrait.shortBio}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: "16px", fontSize: "16px", color: "#999" }}>
            <span>{profile.stats.totalGames} games</span>
            <span>{profile.stats.totalPlaytimeHours}h</span>
            <span>Spirit: {portrait.spiritGame.name}</span>
          </div>
          <div style={{ fontSize: "18px", color: "#666" }}>steampsycho.com</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
