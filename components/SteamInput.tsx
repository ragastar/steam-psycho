"use client";

import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { LoadingAnimation } from "./LoadingAnimation";

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
  const [error, setError] = useState("");
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) {
      setError(t("errors.invalidInput"));
      return;
    }

    setError("");
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
        setError(data.message || t("errors.analysisError"));
        setLoading(false);
        return;
      }

      router.push(`/${locale}/result/${data.steamId64}`);
    } catch {
      setError(t("errors.analysisError"));
      setLoading(false);
    }
  };

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
          className="flex-1 px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors"
        />
        <button
          type="submit"
          className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-medium rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all whitespace-nowrap"
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

      {error && (
        <p className="text-red-400 text-sm text-left">{error}</p>
      )}
    </form>
  );
}
