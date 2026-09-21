"use client";

import { useApp } from "@/components/providers/app-provider";
import { DemandTrendChart } from "@/components/dashboard/demand-trend-chart";
import { KpiStrip } from "@/components/dashboard/kpi-strip";
import { PolicyVerdict } from "@/components/dashboard/policy-verdict";
import { RiskList } from "@/components/dashboard/risk-list";
import { TopRecs } from "@/components/dashboard/top-recs";
import { ErrorState } from "@/components/shared/states";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { barLabel } from "@/lib/engine/aggregate";

export default function DashboardPage() {
  const { status, error, retry, ds, kpis, bar } = useApp();
  if (status === "error") return <ErrorState message={error ?? "Unknown error."} onRetry={retry} />;

  return (
    <div className="space-y-6">
      {ds && kpis ? (
        <PageHeader
          title="Stock position"
          description={`${kpis.seriesCount} items in ${barLabel(bar)}. ${kpis.atRiskCount} need attention now and ${kpis.counts.over} are overstocked.`}
        />
      ) : (
        <div className="mb-6 space-y-2">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-5 w-96 max-w-full" />
        </div>
      )}
      <PolicyVerdict />
      <KpiStrip />
      <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
        <DemandTrendChart />
        <RiskList />
      </div>
      <TopRecs />
    </div>
  );
}
