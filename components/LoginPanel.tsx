"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";

interface Props {
  /** Зовётся, когда вход состоялся: страница-хозяин обновляет себя сама. */
  onSignedIn?: () => void;
  /**
   * Разбор, на который вернуть после входа через Steam (17 цифр).
   *
   * Вход через Telegram остаётся на месте — там страница никуда не уходит.
   * А Steam уводит браузер целиком, и без этого человека возвращало на
   * лендинг: вошёл, но выброшен с разбора, который собирался купить.
   */
  backSteamId?: string;
}

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT || "gamertype_bot";

/** Ссылка без токена: код придумывает бот, сайт его только принимает. */
const BOT_LOGIN_URL = `https://t.me/${BOT_USERNAME}?start=login`;

type LoginError = "" | "taken" | "failed" | "codeWrong" | "tooMany";

export function LoginPanel({ onSignedIn, backSteamId }: Props) {
  const t = useTranslations();
  const [accountId, setAccountId] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<LoginError>("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setAccountId(d.accountId))
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setError("");

    try {
      const res = await fetch("/api/auth/telegram/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (res.ok) {
        const body = await res.json();
        setAccountId(body.accountId);
        onSignedIn?.();
        return;
      }
      // Каждому отказу свой текст: «попробуйте ещё раз» на исчерпанных
      // попытках — совет прямо противоположный правильному.
      if (res.status === 409) setError("taken");
      else if (res.status === 429) setError("tooMany");
      else if (res.status === 403 || res.status === 400) setError("codeWrong");
      else setError("failed");
    } catch {
      // Сетевой сбой (офлайн, DNS) — без этого catch падение здесь было бы
      // необработанным отказом промиса, а человеку не сказали бы ни слова.
      setError("failed");
    } finally {
      setSending(false);
    }
  }

  if (accountId) {
    return <p className="text-sm text-green-400">{t("auth.signedIn")}</p>;
  }

  // Форму проверяет и сервер — здесь она нужна лишь затем, чтобы не отправлять
  // в адрес заведомую бессмыслицу.
  const steamStartUrl =
    backSteamId && /^\d{17}$/.test(backSteamId)
      ? `/api/auth/steam/start?back=${backSteamId}`
      : "/api/auth/steam/start";

  return (
    <div className="space-y-3 text-center">
      <p className="text-sm text-gray-400">{t("auth.signIn")}</p>
      {/* Способ входа выбирается один раз и навсегда: право принадлежит паре
          «аккаунт + разбор», а склеивать аккаунты автоматически спека запрещает.
          Купивший через Telegram, который на третий день выберет здесь Steam,
          заведёт новый аккаунт — и заплатит второй раз. Предупреждение стоит НАД
          кнопками: после нажатия оно уже бесполезно. */}
      <p className="text-sm text-amber-300/90">{t("auth.sameMethod")}</p>
      <div className="flex flex-col sm:flex-row gap-2 justify-center">
        <a
          href={BOT_LOGIN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="px-5 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold transition-colors"
        >
          {t("auth.viaTelegram")}
        </a>
        {/* Это не страница, а серверный маршрут, отвечающий редиректом на Steam;
            next/link дал бы клиентский переход и сломал бы редирект. Правило
            no-html-link-for-pages молчит само: адрес теперь собирается в
            переменной, а не стоит здесь строкой. */}
        <a
          href={steamStartUrl}
          className="px-5 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm font-semibold transition-colors"
        >
          {t("auth.viaSteam")}
        </a>
      </div>

      <p className="text-sm text-gray-400">{t("auth.codeHint")}</p>

      <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2 justify-center">
        <label htmlFor="gt-login-code" className="sr-only">
          {t("auth.codeLabel")}
        </label>
        <input
          id="gt-login-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t("auth.codeLabel")}
          autoComplete="one-time-code"
          maxLength={16}
          className="px-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm tracking-widest uppercase placeholder:normal-case placeholder:tracking-normal"
        />
        <button
          type="submit"
          disabled={sending || !code.trim()}
          className="px-5 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
        >
          {t("auth.codeSubmit")}
        </button>
      </form>

      {error && <p className="text-sm text-red-400">{t(`auth.${error}`)}</p>}
    </div>
  );
}
