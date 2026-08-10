"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";

interface TelegramGateProps {
  steamId64: string;
  locale: string;
  children?: React.ReactNode;
  onUnlock?: () => void;
  /**
   * Доступ уже разрешён сервером — замок рисовать не нужно.
   *
   * Раньше здесь читался NEXT_PUBLIC_DISABLE_GATE, и это давало расхождение:
   * сервер по DISABLE_GATE пускал к полному результату, а браузер по своему
   * (пустому) флагу продолжал требовать подписку. Посетитель видел замок при
   * полностью открытом доступе, и обойти это можно было только пересборкой
   * образа — браузерные переменные вшиваются на этапе сборки.
   *
   * Решение о доступе одно, принимает его сервер и передаёт сюда.
   */
  accessGranted?: boolean;
}

const LS_PREFIX = "gate:";
const POLL_INTERVAL = 3000;
// Имя бота больше не зашито в код: при смене бренда ссылка вела бы в никуда.
const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT || "gamertype_bot";

export function TelegramGate({ steamId64, locale, children, onUnlock, accessGranted = false }: TelegramGateProps) {
  const t = useTranslations("gate");
  const [unlocked, setUnlocked] = useState(accessGranted);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const lsKey = `${LS_PREFIX}${steamId64}`;

  const createToken = useCallback(async (retries = 2): Promise<string | null> => {
    try {
      const res = await fetch("/api/gate/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steamId64, locale }),
      });
      if (!res.ok) {
        if (retries > 0) {
          await new Promise((r) => setTimeout(r, 2000));
          return createToken(retries - 1);
        }
        return null;
      }
      const data = await res.json();
      const tk = data.token as string;
      setToken(tk);
      localStorage.setItem(lsKey, JSON.stringify({ token: tk, unlocked: false }));
      return tk;
    } catch {
      if (retries > 0) {
        await new Promise((r) => setTimeout(r, 2000));
        return createToken(retries - 1);
      }
      return null;
    }
  }, [steamId64, locale, lsKey]);

  /**
   * Меняет открытый токен на подписанную куку. Без этого сервер не отдаст
   * полный результат: решение о доступе принимает он, а не браузер.
   */
  const claimAccess = useCallback(async (tk: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/gate/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tk }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const checkStatus = useCallback(async (tk: string) => {
    try {
      const res = await fetch(`/api/gate/status?token=${tk}`);
      if (!res.ok) return; // Ошибка — ждём дальше, а не открываем доступ.

      const data = await res.json();
      if (data.status === "unlocked") {
        // Доступ открывается только после того, как сервер выдал куку.
        // Раньше три подряд неудачных запроса просто открывали всё сами.
        if (!(await claimAccess(tk))) return;
        setUnlocked(true);
        onUnlock?.();
        localStorage.setItem(lsKey, JSON.stringify({ token: tk, unlocked: true }));
      } else if (data.status === "expired") {
        // Token expired — auto-recreate and update bot link
        localStorage.removeItem(lsKey);
        setToken(null);
        createToken();
      }
    } catch {
      // Сетевой сбой не должен раздавать платное — просто ждём следующей попытки.
    }
  }, [lsKey, createToken, onUnlock, claimAccess]);

  // Init: check localStorage or create token
  useEffect(() => {
    async function init() {
      const stored = localStorage.getItem(lsKey);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.token) {
            setToken(parsed.token);
            // Даже если в localStorage записано unlocked, идём к серверу:
            // эту запись пользователь может выставить сам, а куку — нет.
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

  const botUrl = token
    ? `https://t.me/${BOT_USERNAME}?start=${token}`
    : `https://t.me/${BOT_USERNAME}`;

  // Standalone mode (no children) — just render the CTA card
  if (!children) {
    if (unlocked) return null;
    return (
      <div className="bg-gray-900/95 backdrop-blur-sm rounded-2xl p-6 max-w-sm mx-auto text-center space-y-3 border border-purple-500/30 shadow-lg shadow-purple-500/10">
        <div className="text-3xl">🔒</div>
        <h3 className="text-lg font-bold bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
          {t("title")}
        </h3>
        <p className="text-gray-400 text-sm">{t("description")}</p>
        <a
          href={botUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-lg hover:from-purple-500 hover:to-pink-500 transition-all shadow-lg shadow-purple-500/20"
        >
          {t("button")}
        </a>
        <p className="text-gray-600 text-xs">{t("hint")}</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        className="transition-[filter] duration-700 ease-out"
        style={{
          filter: unlocked ? "none" : "blur(12px)",
          maxHeight: unlocked ? "none" : "280px",
          overflow: unlocked ? "visible" : "hidden",
        }}
      >
        {children}
      </div>

      <AnimatePresence>
        {!unlocked && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="absolute inset-x-0 top-0 bottom-0 flex items-start justify-center z-10 pt-8 bg-gradient-to-b from-transparent via-gray-950/80 to-gray-950"
          >
            <div className="bg-gray-900/95 backdrop-blur-sm rounded-2xl p-6 max-w-sm mx-4 text-center space-y-3 border border-purple-500/30 shadow-lg shadow-purple-500/10">
              <div className="text-3xl">🔒</div>
              <h3 className="text-lg font-bold bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
                {t("title")}
              </h3>
              <p className="text-gray-400 text-sm">{t("description")}</p>
              <a
                href={botUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-lg hover:from-purple-500 hover:to-pink-500 transition-all shadow-lg shadow-purple-500/20"
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
