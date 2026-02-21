"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { LoadingAnimation } from "./LoadingAnimation";
import { ErrorDisplay } from "./ErrorDisplay";

interface Provider {
  id: string;
  name: string;
  model: string;
  available: boolean;
}

export function SteamInput() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [input, setInput] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("");

  useEffect(() => {
    fetch("/api/providers")
      .then((res) => res.json())
      .then((data) => {
        const available: Provider[] = data.providers.filter((p: Provider) => p.available);
        setProviders(available);
        if (available.length > 0 && !selectedProvider) {
          setSelectedProvider(available[0].id);
        }
      })
      .catch(() => {});
  }, [selectedProvider]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) {
      setErrorCode("INVALID_INPUT");
      return;
    }

    setErrorCode("");
    setLoading(true);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: trimmed,
          locale,
          provider: selectedProvider || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorCode(data.code || "ANALYSIS_ERROR");
        setLoading(false);
        return;
      }

      router.push(`/${locale}/result/${data.steamId64}`);
    } catch {
      setErrorCode("ANALYSIS_ERROR");
      setLoading(false);
    }
  }, [input, locale, selectedProvider, router]);

  const handleRetry = useCallback(() => {
    setErrorCode("");
    handleSubmit();
  }, [handleSubmit]);

  if (loading) {
    return <LoadingAnimation />;
  }

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("landing.inputPlaceholder")}
          className="flex-1 px-4 py-3 bg-gray-900/80 border border-gray-700/50 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors"
        />
        <button
          type="submit"
          className="px-6 py-3 bg-gradient-to-r from-purple-600 to-cyan-600 text-white font-semibold rounded-xl hover:from-purple-500 hover:to-cyan-500 transition-all whitespace-nowrap shadow-lg shadow-purple-600/20"
        >
          {t("landing.submitButton")}
        </button>
      </div>

      {providers.length > 1 && (
        <div className="flex items-center justify-center gap-2">
          <span className="text-xs text-gray-500">{t("landing.aiModel")}:</span>
          <div className="flex gap-1">
            {providers.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedProvider(p.id)}
                className={`px-3 py-1 text-xs rounded-full transition-colors ${
                  selectedProvider === p.id
                    ? "bg-purple-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {providers.length === 1 && (
        <p className="text-xs text-gray-600 text-center">
          {t("landing.poweredBy", { model: providers[0].name })}
        </p>
      )}

      {errorCode && (
        <ErrorDisplay code={errorCode} onRetry={handleRetry} />
      )}
    </form>
  );
}
