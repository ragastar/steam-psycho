/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text */
import { ImageResponse } from "next/og";
import { getCache } from "@/lib/cache/redis";
import { portraitKey, profileKey } from "@/lib/cache/keys";
import type { CardPortrait } from "@/lib/llm/types";
import type { AggregatedProfile } from "@/lib/aggregation/types";
import { getRarityTheme } from "@/lib/card/styles";

export const runtime = "nodejs";
export const alt = "GamerType Card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function getTopStats(stats: CardPortrait["stats"]): { key: string; value: number }[] {
  return Object.entries(stats)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);
}

// Strip emoji to avoid Satori crashes (no emoji font loaded)
function stripEmoji(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/[^\x00-\x7F\u00A0-\u024F\u0400-\u04FF\u2000-\u206F\u2070-\u209F\u20A0-\u20CF\u2100-\u214F]/g, "").trim();
}

export default async function OgImage({ params }: { params: { id: string; locale: string } }) {
  try {
    const portrait = await getCache<CardPortrait>(portraitKey(params.id, params.locale));
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
            GamerType
          </div>
        ),
        { ...size },
      );
    }

    const theme = getRarityTheme(portrait.rarity);
    const firstRoast = portrait.roasts[0];
    const topStats = getTopStats(portrait.stats);

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "40px 48px",
            background: `linear-gradient(135deg, ${theme.gradient[0]}, ${theme.gradient[1]})`,
            color: "#fff",
            border: `4px solid ${theme.borderColor}`,
          }}
        >
          {/* Top */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
              <div
                style={{
                  width: "72px",
                  height: "72px",
                  borderRadius: "50%",
                  background: theme.borderColor,
                  border: `3px solid ${theme.borderColor}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "28px",
                  color: "#fff",
                }}
              >
                GT
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: "18px", color: "#999" }}>{profile.player.name}</div>
                <div style={{ fontSize: "32px", fontWeight: 700, color: theme.accentColor }}>
                  {stripEmoji(portrait.primaryArchetype.name)}
                </div>
                <div style={{ fontSize: "14px", color: "#666" }}>{stripEmoji(portrait.title)}</div>
              </div>
            </div>
            <div
              style={{
                padding: "6px 16px",
                borderRadius: "20px",
                background: theme.badgeBg,
                color: theme.badgeText,
                fontSize: "14px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "1px",
              }}
            >
              {portrait.rarity}
            </div>
          </div>

          {/* Top 3 stats */}
          <div style={{ display: "flex", gap: "32px", marginTop: "8px" }}>
            {topStats.map((stat) => (
              <div key={stat.key} style={{ display: "flex", flexDirection: "column", flex: 1, gap: "4px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
                  <span style={{ color: "#999", textTransform: "uppercase" }}>{stat.key}</span>
                  <span style={{ color: theme.accentColor, fontWeight: 700 }}>{stat.value}</span>
                </div>
                <div style={{ height: "10px", background: "#333", borderRadius: "5px", overflow: "hidden", display: "flex" }}>
                  <div
                    style={{
                      width: `${stat.value}%`,
                      height: "100%",
                      background: theme.barColor,
                      borderRadius: "5px",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Roast */}
          <div style={{ display: "flex", flexDirection: "column", marginTop: "8px" }}>
            {firstRoast && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  background: "rgba(255,255,255,0.05)",
                  borderRadius: "12px",
                  padding: "14px 18px",
                  borderLeft: `4px solid ${theme.accentColor}`,
                }}
              >
                <span style={{ fontSize: "16px", color: "#ccc" }}>{stripEmoji(firstRoast.text)}</span>
              </div>
            )}
          </div>

          {/* Bottom */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div style={{ display: "flex", gap: "16px", fontSize: "15px", color: "#999" }}>
              <span>{profile.stats.totalGames} games</span>
              <span>{profile.stats.totalPlaytimeHours}h</span>
              <span>Spirit: {stripEmoji(portrait.spirit_game)}</span>
            </div>
            <div style={{ fontSize: "16px", color: theme.accentColor, fontWeight: 600 }}>gamertype.fun</div>
          </div>
        </div>
      ),
      { ...size },
    );
  } catch (err) {
    console.error("[og-image] Error:", err);
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
          GamerType
        </div>
      ),
      { ...size },
    );
  }
}
