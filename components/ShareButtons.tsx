"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Rarity } from "@/lib/llm/types";

interface ShareButtonsProps {
  steamId64: string;
  archetype: string;
  rarity: Rarity;
  emoji: string;
  locale: string;
}

export function ShareButtons({ steamId64, archetype, rarity, emoji, locale }: ShareButtonsProps) {
  const t = useTranslations("share");
  const [copied, setCopied] = useState(false);

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://gamertype.fun";
  // Share link with ?u=1 so friends see the full card without gate
  const resultUrl = `${baseUrl}/${locale}/result/${steamId64}?u=1`;
  const shareText = t(locale === "ru" ? "shareTextRu" : "shareTextEn", {
    emoji,
    archetype,
    rarity: rarity.toUpperCase(),
  });

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(resultUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const handleDownloadPng = async () => {
    try {
      const res = await fetch(`/api/og/${steamId64}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gamertype-${steamId64}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  };

  const shareTelegram = () => {
    const text = encodeURIComponent(shareText);
    const url = encodeURIComponent(resultUrl);
    window.open(`https://t.me/share/url?url=${url}&text=${text}`, "_blank");
  };

  const shareTwitter = () => {
    const text = encodeURIComponent(shareText);
    const url = encodeURIComponent(resultUrl);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, "_blank");
  };

  const shareVk = () => {
    const url = encodeURIComponent(resultUrl);
    window.open(`https://vk.com/share.php?url=${url}`, "_blank");
  };

  return (
    <div className="flex flex-wrap gap-3 justify-center">
      {/* Telegram — primary */}
      <button
        onClick={shareTelegram}
        className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg hover:opacity-90 transition-all text-sm font-semibold shadow-lg shadow-blue-500/20"
      >
        {t("shareTelegram")}
      </button>
      {/* Secondary buttons */}
      <button
        onClick={shareTwitter}
        className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm"
      >
        {t("shareTwitter")}
      </button>
      <button
        onClick={shareVk}
        className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm"
      >
        {t("shareVk")}
      </button>
      <button
        onClick={handleCopyLink}
        className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm"
      >
        {copied ? t("linkCopied") : t("copyLink")}
      </button>
      <button
        onClick={handleDownloadPng}
        className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm"
      >
        {t("downloadPng")}
      </button>
    </div>
  );
}
