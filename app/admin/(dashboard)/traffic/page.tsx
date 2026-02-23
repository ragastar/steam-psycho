import { getAnalysesByDay, getLocaleDistribution, getCacheDistribution } from "@/lib/analytics/queries";
import ChartCard from "@/components/admin/ChartCard";
import TrafficCharts from "./charts";

export const dynamic = "force-dynamic";

export default function TrafficPage({
  searchParams,
}: {
  searchParams: { days?: string };
}) {
  const days = parseInt(searchParams.days || "30", 10);
  const byDay = getAnalysesByDay(days);
  const locales = getLocaleDistribution();
  const cache = getCacheDistribution();

  const cacheData = cache.map((r) => ({
    name: r.cached ? "Cache Hit" : "Fresh",
    value: r.count,
  }));

  const localeData = locales.map((r) => ({
    name: r.locale.toUpperCase(),
    value: r.count,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Трафик</h1>
      </div>
      <ChartCard title={`Анализы по дням (${days}д)`}>
        <TrafficCharts byDay={byDay} localeData={localeData} cacheData={cacheData} />
      </ChartCard>
    </div>
  );
}
