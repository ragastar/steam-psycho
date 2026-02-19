import type { ResolvedInput } from "./types";

const STEAMID64_REGEX = /^[0-9]{17}$/;
const PROFILE_URL_REGEX =
  /steamcommunity\.com\/profiles\/(\d{17})/;
const VANITY_URL_REGEX =
  /steamcommunity\.com\/id\/([a-zA-Z0-9_-]+)/;

export function parseInput(raw: string): ResolvedInput {
  const input = raw.trim();

  // Full profile URL with SteamID64
  const profileMatch = input.match(PROFILE_URL_REGEX);
  if (profileMatch) {
    return { type: "profileUrl", value: profileMatch[1] };
  }

  // Vanity URL
  const vanityMatch = input.match(VANITY_URL_REGEX);
  if (vanityMatch) {
    return { type: "vanityUrl", value: vanityMatch[1] };
  }

  // Raw SteamID64
  if (STEAMID64_REGEX.test(input)) {
    return { type: "steamId64", value: input };
  }

  // Treat as vanity name (plain text)
  if (input.length >= 2 && input.length <= 32 && /^[a-zA-Z0-9_-]+$/.test(input)) {
    return { type: "vanityName", value: input };
  }

  throw new Error("INVALID_INPUT");
}
