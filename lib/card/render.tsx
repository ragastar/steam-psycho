/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text */
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import type { Portrait } from "../llm/types";
import type { AggregatedProfile } from "../aggregation/types";
import { getTheme } from "./styles";

let fontData: ArrayBuffer | null = null;

async function getFont(): Promise<ArrayBuffer> {
  if (fontData) return fontData;
  const res = await fetch(
    "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZhrib2Bg-4.ttf",
  );
  fontData = await res.arrayBuffer();
  return fontData;
}

export async function renderCardPng(
  portrait: Portrait,
  profile: AggregatedProfile,
): Promise<Buffer> {
  const theme = getTheme(portrait.archetype);
  const font = await getFont();
  const topGenres = profile.genreDistribution.slice(0, 3);

  const svg = await satori(
    <div
      style={{
        width: "1200px",
        height: "630px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "48px 56px",
        background: `linear-gradient(135deg, ${theme.bgGradient[0]}, ${theme.bgGradient[1]})`,
        color: theme.textColor,
        fontFamily: "Inter",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
        <img
          src={profile.player.avatar}
          width={80}
          height={80}
          style={{ borderRadius: "50%", border: `3px solid ${theme.accentColor}` }}
        />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: "20px", color: "#999" }}>{profile.player.name}</div>
          <div style={{ fontSize: "40px", fontWeight: 700, color: theme.accentColor }}>
            {portrait.archetypeEmoji} {portrait.archetype}
          </div>
        </div>
      </div>

      <div style={{ fontSize: "18px", color: "#ccc", lineHeight: 1.5, maxWidth: "800px" }}>
        {portrait.shortBio}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {topGenres.map((g) => (
            <div key={g.genre} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ fontSize: "14px", color: "#999", width: "100px" }}>{g.genre}</div>
              <div
                style={{
                  width: "200px",
                  height: "12px",
                  background: "#333",
                  borderRadius: "6px",
                  overflow: "hidden",
                  display: "flex",
                }}
              >
                <div
                  style={{
                    width: `${g.percentage}%`,
                    height: "100%",
                    background: theme.accentColor,
                    borderRadius: "6px",
                  }}
                />
              </div>
              <div style={{ fontSize: "14px", color: "#999" }}>{g.percentage}%</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <div style={{ fontSize: "14px", color: "#666" }}>
            Spirit Game: {portrait.spiritGame.name}
          </div>
          <div style={{ fontSize: "16px", color: "#666", marginTop: "8px" }}>
            steampsycho.com
          </div>
        </div>
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
