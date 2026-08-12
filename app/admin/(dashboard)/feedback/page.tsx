import { getRecentFeedback, getFeedbackCount } from "@/lib/analytics/queries";
import StatCard from "@/components/admin/StatCard";

export const dynamic = "force-dynamic";

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
}

export default function FeedbackPage() {
  const items = getRecentFeedback();
  const total = getFeedbackCount();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Обратная связь</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Всего сообщений" value={String(total)} />
        <StatCard label="Показано" value={String(items.length)} />
        <StatCard label="С контактом" value={String(items.filter((i) => i.contact).length)} />
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">Пока пусто. Плашка стоит на странице результата.</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <article key={item.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
              <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                <span>{formatTimestamp(item.timestamp)}</span>
                {item.steam_id64 && (
                  <a
                    href={`/ru/result/${item.steam_id64}`}
                    className="text-purple-400 hover:text-purple-300"
                  >
                    {item.steam_id64}
                  </a>
                )}
                {item.page && <span className="text-zinc-600">{item.page}</span>}
              </div>
              {/* Текст человека — как есть, включая переносы строк. */}
              <p className="whitespace-pre-wrap break-words text-sm text-zinc-200">{item.text}</p>
              {item.contact && (
                <p className="mt-2 text-xs text-emerald-400">Ответить: {item.contact}</p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
