export interface CardTheme {
  bgGradient: string[];
  accentColor: string;
  textColor: string;
}

const THEMES: Record<string, CardTheme> = {
  strategist: {
    bgGradient: ["#1a1a2e", "#16213e"],
    accentColor: "#e2b714",
    textColor: "#ffffff",
  },
  explorer: {
    bgGradient: ["#1a2e1a", "#162e21"],
    accentColor: "#4ecca3",
    textColor: "#ffffff",
  },
  warrior: {
    bgGradient: ["#2e1a1a", "#3e1616"],
    accentColor: "#e74c3c",
    textColor: "#ffffff",
  },
  collector: {
    bgGradient: ["#1a1a2e", "#2e1a3e"],
    accentColor: "#9b59b6",
    textColor: "#ffffff",
  },
  default: {
    bgGradient: ["#0f0f1a", "#1a0f2e"],
    accentColor: "#a855f7",
    textColor: "#ffffff",
  },
};

export function getTheme(archetype: string): CardTheme {
  const lower = archetype.toLowerCase();
  for (const [key, theme] of Object.entries(THEMES)) {
    if (key !== "default" && lower.includes(key)) {
      return theme;
    }
  }
  return THEMES.default;
}
