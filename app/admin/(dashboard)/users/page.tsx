import { getRarityDistribution, getAverageStats, getTopArchetypes, getTopCreatures, getTopElements } from "@/lib/analytics/queries";
import ChartCard from "@/components/admin/ChartCard";
import UsersCharts from "./charts";
import DataTable from "@/components/admin/DataTable";

export const dynamic = "force-dynamic";

export default function UsersPage() {
  const rarity = getRarityDistribution();
  const avgStats = getAverageStats();
  const topArchetypes = getTopArchetypes();
  const topCreatures = getTopCreatures();
  const topElements = getTopElements();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Пользователи</h1>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Распределение редкости">
          <UsersCharts rarity={rarity} avgStats={avgStats} />
        </ChartCard>

        <ChartCard title="Средние статы">
          <UsersCharts rarity={[]} avgStats={avgStats} showRadar />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCard title="Топ архетипов">
          <DataTable
            columns={[
              { key: "primary_archetype", label: "Архетип" },
              { key: "count", label: "#", align: "right" },
            ]}
            rows={topArchetypes}
          />
        </ChartCard>

        <ChartCard title="Топ существ">
          <DataTable
            columns={[
              { key: "spirit_animal", label: "Существо" },
              { key: "count", label: "#", align: "right" },
            ]}
            rows={topCreatures}
          />
        </ChartCard>

        <ChartCard title="Топ элементов">
          <DataTable
            columns={[
              { key: "element", label: "Элемент" },
              { key: "count", label: "#", align: "right" },
            ]}
            rows={topElements}
          />
        </ChartCard>
      </div>
    </div>
  );
}
