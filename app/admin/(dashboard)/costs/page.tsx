import { getCostsByDay, getTotalCosts } from "@/lib/analytics/queries";
import StatCard from "@/components/admin/StatCard";
import ChartCard from "@/components/admin/ChartCard";
import DataTable from "@/components/admin/DataTable";

export const dynamic = "force-dynamic";

export default function CostsPage({
  searchParams,
}: {
  searchParams: { days?: string };
}) {
  const days = parseInt(searchParams.days || "30", 10);
  const byDay = getCostsByDay(days);
  const totals = getTotalCosts();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Расходы</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="LLM всего" value={`$${totals.llmTotal}`} sub={`${totals.llmCount} запросов × $0.003`} />
        <StatCard label="Арт всего" value={`$${totals.artTotal}`} sub={`${totals.artCount} генераций × $0.04`} />
        <StatCard label="Итого" value={`$${totals.grandTotal}`} />
      </div>

      <ChartCard title={`Расходы по дням (${days}д)`}>
        <DataTable
          columns={[
            { key: "day", label: "Дата" },
            { key: "llmCount", label: "LLM", align: "right" },
            { key: "artCount", label: "Арт", align: "right" },
            { key: "llmCost", label: "LLM $", align: "right" },
            { key: "artCost", label: "Арт $", align: "right" },
            { key: "totalCost", label: "Итого $", align: "right" },
          ]}
          rows={byDay}
        />
      </ChartCard>
    </div>
  );
}
