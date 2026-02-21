import type { Rarity } from "../llm/types";

export interface RarityTheme {
  borderColor: string;
  gradient: [string, string];
  glowShadow: string;
  accentColor: string;
  badgeBg: string;
  badgeText: string;
  barColor: string;
}

const RARITY_THEMES: Record<Rarity, RarityTheme> = {
  common: {
    borderColor: "#6b7280",
    gradient: ["#1f2937", "#111827"],
    glowShadow: "0 0 20px rgba(107, 114, 128, 0.3)",
    accentColor: "#9ca3af",
    badgeBg: "#374151",
    badgeText: "#d1d5db",
    barColor: "#6b7280",
  },
  uncommon: {
    borderColor: "#22c55e",
    gradient: ["#052e16", "#0a1f0d"],
    glowShadow: "0 0 20px rgba(34, 197, 94, 0.3)",
    accentColor: "#4ade80",
    badgeBg: "#14532d",
    badgeText: "#86efac",
    barColor: "#22c55e",
  },
  rare: {
    borderColor: "#3b82f6",
    gradient: ["#0c1f3f", "#0a1628"],
    glowShadow: "0 0 20px rgba(59, 130, 246, 0.3)",
    accentColor: "#60a5fa",
    badgeBg: "#1e3a5f",
    badgeText: "#93c5fd",
    barColor: "#3b82f6",
  },
  epic: {
    borderColor: "#a855f7",
    gradient: ["#2e1065", "#1a0533"],
    glowShadow: "0 0 20px rgba(168, 85, 247, 0.3)",
    accentColor: "#c084fc",
    badgeBg: "#3b0764",
    badgeText: "#d8b4fe",
    barColor: "#a855f7",
  },
  legendary: {
    borderColor: "#f59e0b",
    gradient: ["#451a03", "#2a1000"],
    glowShadow: "0 0 30px rgba(245, 158, 11, 0.4)",
    accentColor: "#fbbf24",
    badgeBg: "#713f12",
    badgeText: "#fde68a",
    barColor: "#f59e0b",
  },
};

export function getRarityTheme(rarity: Rarity): RarityTheme {
  return RARITY_THEMES[rarity];
}
