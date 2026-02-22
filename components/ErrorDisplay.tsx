"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";

interface ErrorDisplayProps {
  code: string;
  onRetry?: () => void;
}

const ERROR_CODE_MAP: Record<string, string> = {
  INVALID_INPUT: "invalidInput",
  PROFILE_NOT_FOUND: "profileNotFound",
  PRIVATE_PROFILE: "privateProfile",
  HIDDEN_LIBRARY: "hiddenLibrary",
  FEW_GAMES: "fewGames",
  EMPTY_LIBRARY: "emptyLibrary",
  NO_PLAYTIME: "noPlaytime",
  STEAM_UNAVAILABLE: "steamUnavailable",
  ANALYSIS_ERROR: "analysisError",
  RATE_LIMITED: "rateLimited",
};

export function ErrorDisplay({ code, onRetry }: ErrorDisplayProps) {
  const t = useTranslations("errors");
  const key = ERROR_CODE_MAP[code] || "analysisError";
  const [retryCountdown, setRetryCountdown] = useState<number | null>(
    code === "STEAM_UNAVAILABLE" ? 30 : null,
  );

  useEffect(() => {
    if (retryCountdown === null || retryCountdown <= 0) return;
    const timer = setTimeout(() => setRetryCountdown(retryCountdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [retryCountdown]);

  useEffect(() => {
    if (retryCountdown === 0 && onRetry) {
      onRetry();
      setRetryCountdown(30);
    }
  }, [retryCountdown, onRetry]);

  const title = t(`${key}.title`);
  const description = t(`${key}.description`);

  let steps: string[] = [];
  try {
    // next-intl returns the raw value for array-like keys
    const stepsRaw = t.raw(`${key}.steps`);
    if (Array.isArray(stepsRaw)) steps = stepsRaw;
  } catch {
    // no steps for this error
  }

  let action: string | null = null;
  try {
    const actionRaw = t.raw(`${key}.action`);
    if (typeof actionRaw === "string") action = actionRaw;
  } catch {
    // no action for this error
  }

  return (
    <div className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-5 space-y-3">
      <h3 className="text-red-400 font-semibold text-base">{title}</h3>
      <p className="text-gray-300 text-sm">{description}</p>

      {steps.length > 0 && (
        <ol className="space-y-2 text-sm text-gray-400">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-purple-400 font-semibold flex-shrink-0">{i + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}

      {code === "STEAM_UNAVAILABLE" && retryCountdown !== null && retryCountdown > 0 && (
        <p className="text-xs text-gray-500">
          {`Auto-retry in ${retryCountdown}s...`}
        </p>
      )}

      {action && onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition-colors"
        >
          {action}
        </button>
      )}
    </div>
  );
}
