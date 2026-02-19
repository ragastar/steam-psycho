"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

interface ShareButtonsProps {
  steamId64: string;
}

export function ShareButtons({ steamId64 }: ShareButtonsProps) {
  const t = useTranslations("share");
  const [copied, setCopied] = useState(false);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const resultUrl = `${baseUrl}${window.location.pathname}`;

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
      a.download = `steam-psycho-${steamId64}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  };

  const shareTwitter = () => {
    const text = encodeURIComponent("Check out my Steam Psycho profile!");
    const url = encodeURIComponent(resultUrl);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, "_blank");
  };

  const shareTelegram = () => {
    const url = encodeURIComponent(resultUrl);
    window.open(`https://t.me/share/url?url=${url}`, "_blank");
  };

  const shareVk = () => {
    const url = encodeURIComponent(resultUrl);
    window.open(`https://vk.com/share.php?url=${url}`, "_blank");
  };

  return (
    <div className="flex flex-wrap gap-3 justify-center">
      <button
        onClick={handleDownloadPng}
        className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm"
      >
        {t("downloadPng")}
      </button>
      <button
        onClick={handleCopyLink}
        className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm"
      >
        {copied ? t("linkCopied") : t("copyLink")}
      </button>
      <button
        onClick={shareTwitter}
        className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm"
      >
        {t("shareTwitter")}
      </button>
      <button
        onClick={shareTelegram}
        className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm"
      >
        {t("shareTelegram")}
      </button>
      <button
        onClick={shareVk}
        className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm"
      >
        {t("shareVk")}
      </button>
    </div>
  );
}
