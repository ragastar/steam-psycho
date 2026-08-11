"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";

interface Props {
  /** Куда вернуться после входа — пока не используется, задел под план Б. */
  onSignedIn?: () => void;
}

export function LoginPanel({ onSignedIn }: Props) {
  const t = useTranslations();
  const [accountId, setAccountId] = useState<number | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<"" | "taken" | "failed" | "timedOut">("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Защёлка от двойного клика: закрывается ПЕРВОЙ строкой функции, до
  // всякого await, — как startedRef в TeaserPage. Если закрывать её после
  // await (например, вместе с setWaiting), второй клик успевает попасть
  // в щель между вызовом и первым await и завести собственный setInterval,
  // который перезапишет pollRef.current и станет недостижим для очистки.
  const startingRef = useRef(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setAccountId(d.accountId))
      .catch(() => {});
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startTelegram = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setError("");
    setWaiting(true);

    try {
      const res = await fetch("/api/auth/telegram/start", { method: "POST" });
      if (!res.ok) {
        setError("failed");
        setWaiting(false);
        startingRef.current = false;
        return;
      }
      const { token, url } = await res.json();

      window.open(url, "_blank", "noopener");

      // Бот подтверждает токен на своей стороне, страница об этом не узнает
      // сама — поэтому опрашиваем. Пять минут, потом сдаёмся: токен всё равно
      // живёт десять.
      let left = 100;
      pollRef.current = setInterval(async () => {
        if (left-- <= 0) {
          if (pollRef.current) clearInterval(pollRef.current);
          setWaiting(false);
          // Пять минут прошло — токен ещё жив (TTL 10 минут), но человек
          // мог закрыть бота или передумать. Отдельный текст, а не общий
          // "failed": это не сбой запроса, а истечение отведённого времени
          // ожидания, и объяснить стоит именно это.
          setError("timedOut");
          startingRef.current = false;
          return;
        }
        const claim = await fetch("/api/auth/telegram/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (claim.status === 409) {
          if (pollRef.current) clearInterval(pollRef.current);
          setWaiting(false);
          setError("taken");
          startingRef.current = false;
          return;
        }
        if (claim.ok) {
          if (pollRef.current) clearInterval(pollRef.current);
          const { accountId } = await claim.json();
          setWaiting(false);
          setAccountId(accountId);
          startingRef.current = false;
          onSignedIn?.();
        }
      }, 3000);
    } catch {
      // Сетевой сбой на самом старте (офлайн, DNS) — тот же путь, что и
      // неуспешный ответ сервера: без этого catch падение здесь превращалось
      // в необработанный отказ промиса без единого слова человеку.
      setError("failed");
      setWaiting(false);
      startingRef.current = false;
    }
  }, [onSignedIn]);

  if (accountId) {
    return <p className="text-sm text-green-400">{t("auth.signedIn")}</p>;
  }

  return (
    <div className="space-y-3 text-center">
      <p className="text-sm text-gray-400">{t("auth.signIn")}</p>
      <div className="flex flex-col sm:flex-row gap-2 justify-center">
        <button
          onClick={startTelegram}
          disabled={waiting}
          className="px-5 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
        >
          {t("auth.viaTelegram")}
        </button>
        <a
          href="/api/auth/steam/start"
          className="px-5 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm font-semibold transition-colors"
        >
          {t("auth.viaSteam")}
        </a>
      </div>
      {waiting && <p className="text-sm text-gray-400">{t("auth.waiting")}</p>}
      {error && <p className="text-sm text-red-400">{t(`auth.${error}`)}</p>}
    </div>
  );
}
