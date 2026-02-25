"use client";

import { useState } from "react";

export default function ResetButtons() {
  const [loading, setLoading] = useState<string | null>(null);
  const [result, setResult] = useState<{ type: "ok" | "err"; msg: string } | null>(null);

  async function getToken(): Promise<string> {
    const pwd = prompt("Введи ADMIN_SECRET:");
    return pwd || "";
  }

  async function resetAnalytics() {
    if (!confirm("Удалить ВСЮ статистику (analyses, errors, art_generations, gate_events)?")) return;
    const token = await getToken();
    if (!token) return;

    setLoading("analytics");
    setResult(null);
    try {
      const res = await fetch("/api/admin/analytics/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ type: "ok", msg: "Статистика сброшена" });
      } else {
        setResult({ type: "err", msg: data.error || "Ошибка" });
      }
    } catch (e) {
      setResult({ type: "err", msg: String(e) });
    } finally {
      setLoading(null);
    }
  }

  async function flushCache() {
    if (!confirm("Очистить ВСЕ кешированные профили (Redis + memory)?")) return;
    const token = await getToken();
    if (!token) return;

    setLoading("cache");
    setResult(null);
    try {
      const res = await fetch("/api/admin/cache/flush", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ type: "ok", msg: "Кеш очищен" });
      } else {
        setResult({ type: "err", msg: data.error || "Ошибка" });
      }
    } catch (e) {
      setResult({ type: "err", msg: String(e) });
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-3 flex-wrap">
        <button
          onClick={flushCache}
          disabled={loading !== null}
          className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {loading === "cache" ? "Очищаем..." : "Сбросить профили (кеш)"}
        </button>
        <button
          onClick={resetAnalytics}
          disabled={loading !== null}
          className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {loading === "analytics" ? "Удаляем..." : "Сбросить статистику (SQLite)"}
        </button>
      </div>
      {result && (
        <p className={`text-sm ${result.type === "ok" ? "text-green-400" : "text-red-400"}`}>
          {result.msg}
        </p>
      )}
    </div>
  );
}
