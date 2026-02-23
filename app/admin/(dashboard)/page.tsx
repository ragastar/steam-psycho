import { getOverviewStats } from "@/lib/analytics/queries";
import StatCard from "@/components/admin/StatCard";

export const dynamic = "force-dynamic";

export default function AdminOverviewPage() {
  const stats = getOverviewStats();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Обзор</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Всего анализов" value={stats.totalAnalyses} />
        <StatCard label="Сегодня" value={stats.todayAnalyses} sub={`${stats.uniqueToday} уникальных`} />
        <StatCard label="Уникальные пользователи" value={stats.uniqueUsers} />
        <StatCard label="Error rate (24ч)" value={`${stats.errorRate}%`} />
        <StatCard label="Арт-генераций" value={stats.artGenerations} />
        <StatCard label="Cache hit rate" value={`${stats.cacheHitRate}%`} />
        <StatCard label="Gate unlocks" value={stats.gateUnlocks} />
        <StatCard label="Средний playtime" value={`${stats.avgPlaytimeHours}ч`} />
      </div>
    </div>
  );
}
