"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";

interface TelegramGateProps {
  steamId64: string;
  locale: string;
  children: React.ReactNode;
}

const LS_PREFIX = "gate:";
const POLL_INTERVAL = 3000;

export function TelegramGate({ steamId64, locale, children }: TelegramGateProps) {
  const t = useTranslations("gate");
  const gateDisabled = process.env.NEXT_PUBLIC_DISABLE_GATE === "true";
  // Auto-unlock for shared links (?u=1) so friends see full card
  const isSharedLink = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("u") === "1";
  const [unlocked, setUnlocked] = useState(gateDisabled || isSharedLink);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const lsKey = `${LS_PREFIX}${steamId64}`;

  const checkStatus = useCallback(async (tk: string) => {
    try {
      const res = await fetch(`/api/gate/status?token=${tk}`);
      if (!res.ok) {
        setUnlocked(true);
        return;
      }
      const data = await res.json();
      if (data.status === "unlocked") {
        setUnlocked(true);
        localStorage.setItem(lsKey, JSON.stringify({ token: tk, unlocked: true }));
      } else if (data.status === "expired") {
        // Token expired, create new one
        localStorage.removeItem(lsKey);
        setToken(null);
      }
    } catch {
      // Graceful degradation
      setUnlocked(true);
    }
  }, [lsKey]);

  const createToken = useCallback(async () => {
    try {
      const res = await fetch("/api/gate/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steamId64, locale }),
      });
      if (!res.ok) {
        setUnlocked(true);
        return;
      }
      const data = await res.json();
      const tk = data.token as string;
      setToken(tk);
      localStorage.setItem(lsKey, JSON.stringify({ token: tk, unlocked: false }));
      return tk;
    } catch {
      // Graceful degradation
      setUnlocked(true);
      return null;
    }
  }, [steamId64, locale, lsKey]);

  // Init: check localStorage or create token
  useEffect(() => {
    async function init() {
      const stored = localStorage.getItem(lsKey);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.unlocked) {
            setUnlocked(true);
            setLoading(false);
            return;
          }
          if (parsed.token) {
            setToken(parsed.token);
            await checkStatus(parsed.token);
            setLoading(false);
            return;
          }
        } catch {
          localStorage.removeItem(lsKey);
        }
      }
      await createToken();
      setLoading(false);
    }
    init();
  }, [lsKey, checkStatus, createToken]);

  // Polling
  useEffect(() => {
    if (unlocked || !token) return;

    intervalRef.current = setInterval(() => {
      checkStatus(token);
    }, POLL_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [unlocked, token, checkStatus]);

  // Stop polling on unlock
  useEffect(() => {
    if (unlocked && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [unlocked]);

  if (loading) return null;

  const botUrl = token ? `https://t.me/gamertype_bot?start=${token}` : "https://t.me/gamertype_bot";

  return (
    <div className="relative">
      <div
        className="transition-[filter] duration-700 ease-out"
        style={{ filter: unlocked ? "none" : "blur(8px)" }}
      >
        {children}
      </div>

      <AnimatePresence>
        {!unlocked && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="absolute inset-0 flex items-center justify-center z-10"
          >
            <div className="bg-gray-900/95 backdrop-blur-sm rounded-2xl p-8 max-w-sm mx-4 text-center space-y-4 border border-purple-500/30 shadow-lg shadow-purple-500/10">
              <div className="text-4xl">🔒</div>
              <h3 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
                {t("title")}
              </h3>
              <p className="text-gray-400 text-sm">{t("description")}</p>
              <a
                href={botUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-lg hover:from-purple-500 hover:to-pink-500 transition-all"
              >
                {t("button")}
              </a>
              <p className="text-gray-600 text-xs">{t("hint")}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
