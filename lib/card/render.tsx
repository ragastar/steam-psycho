/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text */
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import type { CardPortrait } from "../llm/types";
import type { AggregatedProfile } from "../aggregation/types";
import { getRarityTheme } from "./styles";

let fontData: ArrayBuffer | null = null;

async function getFont(): Promise<ArrayBuffer> {
  if (fontData) return fontData;
  const res = await fetch(
    "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZhrib2Bg-4.ttf",
  );
  fontData = await res.arrayBuffer();
  return fontData;
}

// Pick top 3 stats by value
function getTopStats(stats: CardPortrait["stats"]): { key: string; value: number }[] {
  return Object.entries(stats)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);
}

export async function renderCardPng(
  portrait: CardPortrait,
  profile: AggregatedProfile,
): Promise<Buffer> {
  const theme = getRarityTheme(portrait.rarity);
  const font = await getFont();
  const firstRoast = portrait.roasts[0];
  const topStats = getTopStats(portrait.stats);

  const svg = await satori(
    <div
      style={{
        width: "1200px",
        height: "630px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "40px 48px",
        background: `linear-gradient(135deg, ${theme.gradient[0]}, ${theme.gradient[1]})`,
        color: "#ffffff",
        fontFamily: "Inter",
        border: `4px solid ${theme.borderColor}`,
      }}
    >
      {/* Top: avatar + archetype + rarity */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <img
            src={profile.player.avatar}
            width={72}
            height={72}
            style={{ borderRadius: "50%", border: `3px solid ${theme.borderColor}` }}
          />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: "18px", color: "#999" }}>{profile.player.name}</div>
            <div style={{ fontSize: "32px", fontWeight: 700, color: theme.accentColor }}>
              {portrait.emoji} {portrait.primaryArchetype.name}
            </div>
            <div style={{ fontSize: "14px", color: "#666" }}>{portrait.title}</div>
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

      {/* Middle: top 3 stats */}
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
            <span style={{ fontSize: "24px" }}>{firstRoast.icon}</span>
            <span style={{ fontSize: "16px", color: "#ccc" }}>{firstRoast.text}</span>
          </div>
        )}
      </div>

      {/* Bottom */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div style={{ display: "flex", gap: "16px", fontSize: "15px", color: "#999" }}>
          <span>{profile.stats.totalGames} games</span>
          <span>{profile.stats.totalPlaytimeHours}h</span>
          <span>Spirit: {portrait.spirit_game}</span>
        </div>
        <div style={{ fontSize: "16px", color: theme.accentColor, fontWeight: 600 }}>gamertype.fun</div>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: "Inter",
          data: font,
          weight: 700,
          style: "normal" as const,
        },
      ],
    },
  );

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width" as const, value: 1200 },
  });
  const pngData = resvg.render();
  return Buffer.from(pngData.asPng());
}
