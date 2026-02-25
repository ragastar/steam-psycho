"use client";

import { useState } from "react";

export default function ResetButtons() {
  const [loading, setLoading] = useState<string | null>(null);
  const [result, setResult] = useState<{ type: "ok" | "err"; msg: string } | null>(null);

  async function getToken(): Promise<string> {
    const pwd = prompt("Введи ADMIN_SECRET:");
    return pwd || "";
  }

  async function callApi(url: string, confirmMsg: string, loadingKey: string, successMsg: string) {
    if (!confirm(confirmMsg)) return;
    const token = await getToken();
    if (!token) return;

    setLoading(loadingKey);
    setResult(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ type: "ok", msg: data.message || successMsg });
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
          onClick={() => callApi(
            "/api/admin/cache/flush",
            "Сбросить кеш профилей? При следующем запросе профили будут сгенерены заново.",
            "cache",
            "Кеш очищен",
          )}
          disabled={loading !== null}
          className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {loading === "cache" ? "Очищаем..." : "Сбросить профили (кеш)"}
        </button>
        <button
          onClick={() => callApi(
            "/api/admin/art/clear",
            "Удалить ВСЕ сгенерированные картинки? Они перегенерятся при следующем запросе.",
            "art",
            "Картинки удалены",
          )}
          disabled={loading !== null}
          className="px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {loading === "art" ? "Удаляем..." : "Удалить арт-картинки"}
        </button>
        <button
          onClick={() => callApi(
            "/api/admin/analytics/reset",
            "Удалить ВСЮ статистику (analyses, errors, art_generations, gate_events)?",
            "analytics",
            "Статистика сброшена",
          )}
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
