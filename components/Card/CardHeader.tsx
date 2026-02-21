"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import type { CardPortrait } from "@/lib/llm/types";
import type { AggregatedProfile } from "@/lib/aggregation/types";

interface CardHeaderProps {
  portrait: CardPortrait;
  profile: AggregatedProfile;
  rarityGradient: string;
  rarityBorder: string;
  steamId64: string;
  locale: string;
}

export function CardHeader({ portrait, profile, rarityGradient, rarityBorder, steamId64, locale }: CardHeaderProps) {
  const [artUrl, setArtUrl] = useState<string | null>(null);
  const [artLoading, setArtLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadArt() {
      try {
        const res = await fetch("/api/art/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ steamId64, locale }),
        });
        if (!res.ok) {
          setArtLoading(false);
          return;
        }
        const data = await res.json();
        if (!cancelled && data.imageUrl) {
          setArtUrl(data.imageUrl);
        }
      } catch {
        // fallback to emoji
      } finally {
        if (!cancelled) setArtLoading(false);
      }
    }

    loadArt();
    return () => { cancelled = true; };
  }, [steamId64, locale]);

  const handleDownloadArt = () => {
    if (!artUrl) return;
    const a = document.createElement("a");
    a.href = artUrl;
    a.download = `gamertype-art-${steamId64}.png`;
    a.click();
  };

  return (
    <div className="relative">
      {/* Art Zone (5:3 aspect ratio) */}
      <div className="relative w-full" style={{ paddingBottom: "60%" }}>
        {artUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={artUrl}
              alt={portrait.primaryArchetype.name}
              className="absolute inset-0 w-full h-full object-cover rounded-t-2xl"
            />
            {/* Download button */}
            <button
              onClick={handleDownloadArt}
              className="absolute top-3 right-3 z-20 p-2 bg-black/50 hover:bg-black/70 rounded-lg transition-colors backdrop-blur-sm"
              title="Download art"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          </>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center rounded-t-2xl">
            {artLoading ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-10 h-10 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-gray-500">Generating art...</span>
              </div>
            ) : (
              <span className="text-8xl">{portrait.emoji}</span>
            )}
          </div>
        )}
        {/* Gradient overlay at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-gray-950 to-transparent" />
      </div>

      {/* Identity Section */}
      <div className="relative -mt-16 px-6 pb-4">
        <div className="flex items-end gap-4">
          <Image
            src={profile.player.avatar}
            alt={profile.player.name}
            width={80}
            height={80}
            className={`rounded-full border-3 ${rarityBorder} shadow-lg relative z-10`}
          />
          <div className="flex-1 min-w-0 pb-1">
            <p className="text-gray-400 text-sm truncate">{profile.player.name}</p>
            <h1 className="font-cinzel text-xl sm:text-2xl font-bold truncate">
              <span className={`bg-gradient-to-r ${rarityGradient} bg-clip-text text-transparent`}>
                {portrait.primaryArchetype.name}
              </span>
            </h1>
            <p className="text-gray-400 text-xs mt-0.5">{portrait.title}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
