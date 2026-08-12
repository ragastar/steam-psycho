"use client";

import { useState } from "react";

/**
 * Плашка обратной связи. Текст заголовка — дословный, по требованию владельца.
 *
 * Стоит на странице результата и видна всем, включая тех, кто ничего не
 * покупал: сказать «шляпа не работает» должен мочь любой.
 */
export function FeedbackBanner({ steamId64, locale }: { steamId64?: string; locale: string }) {
  const [text, setText] = useState("");
  const [contact, setContact] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  const isRu = locale === "ru";
  const title = isRu ? "ОСТАВЬ ОБРАТНУЮ СВЯЗЬ НАХУЙ" : "LEAVE SOME FUCKING FEEDBACK";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (text.trim().length < 2 || state === "sending") return;

    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          contact,
          steamId64,
          page: typeof window !== "undefined" ? window.location.pathname : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState("error");
        setError(data?.message || (isRu ? "Не отправилось" : "Failed to send"));
        return;
      }
      setState("sent");
    } catch {
      setState("error");
      setError(isRu ? "Не отправилось" : "Failed to send");
    }
  }

  if (state === "sent") {
    return (
      <div className="rounded-xl border border-emerald-700/50 bg-emerald-900/20 p-5 text-center">
        <p className="text-lg font-bold text-emerald-400">
          {isRu ? "ЗАПИСАЛИ. СПАСИБО НАХУЙ" : "GOT IT. THANKS A FUCKING LOT"}
        </p>
        <p className="mt-1 text-sm text-gray-400">
          {isRu ? "Правда прочитаем." : "We'll actually read it."}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-purple-700/50 bg-purple-900/10 p-5 space-y-3">
      <h3 className="text-center text-xl font-black tracking-tight text-purple-300">{title}</h3>
      <p className="text-center text-sm text-gray-400">
        {isRu
          ? "Что понравилось, что бесит, что наврали — пиши как есть."
          : "What you liked, what pissed you off, what we got wrong — say it straight."}
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={4000}
        rows={4}
        placeholder={isRu ? "Здесь." : "Right here."}
        className="w-full resize-y rounded-lg border border-gray-700 bg-gray-900/80 p-3 text-sm text-gray-100 placeholder-gray-600 focus:border-purple-500 focus:outline-none"
      />

      <input
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        maxLength={200}
        placeholder={isRu ? "Телега или почта, если ждёшь ответа (необязательно)" : "Telegram or email if you want a reply (optional)"}
        className="w-full rounded-lg border border-gray-700 bg-gray-900/80 p-3 text-sm text-gray-100 placeholder-gray-600 focus:border-purple-500 focus:outline-none"
      />

      {state === "error" && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={text.trim().length < 2 || state === "sending"}
        className="w-full rounded-lg bg-purple-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
      >
        {state === "sending" ? (isRu ? "Отправляем…" : "Sending…") : isRu ? "ОТПРАВИТЬ" : "SEND"}
      </button>
    </form>
  );
}
