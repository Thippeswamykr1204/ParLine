"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { DemandForecastChart } from "@/components/item/demand-forecast-chart";
import { ItemSimChart } from "@/components/item/item-sim-chart";
import { ParBuild } from "@/components/item/par-build";
import { ParLadder } from "@/components/item/par-ladder";
import { RecommendationPanel } from "@/components/item/recommendation-panel";
import { useApp } from "@/components/providers/app-provider";
import { AbcPill, StatusBadge } from "@/components/shared/status";
import { StockGauge } from "@/components/shared/stock-gauge";
import { ErrorState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_LEAD_TIME } from "@/lib/config";
import { fmtDate, fmtDays, fmtVolume } from "@/lib/format";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-card p-4">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-display text-[22px] font-semibold leading-tight tabular-nums">{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

export default function ItemPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { status, error, retry, ds, allRows, policy } = useApp();

  if (status === "error") return <ErrorState message={error ?? "Unknown error."} onRetry={retry} />;
  if (status === "loading" || !ds) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-44 w-full rounded-panel" />
        <Skeleton className="h-96 w-full rounded-panel" />
      </div>
    );
  }

  const row = allRows.find((r) => r.id === id);
  if (!row) {
    return (
      <ErrorState
        title="Item not found"
        message="No bar and brand in the dataset matches this link. Pick an item from the inventory list."
        onRetry={undefined}
      />
    );
  }
  const meta = ds.seriesById.get(id);

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/inventory" className="hover:text-foreground hover:underline">
          Inventory
        </Link>
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
        <span>{row.bar}</span>
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
        <span className="font-medium text-foreground">{row.brand}</span>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[32px] font-semibold leading-tight">{row.brand}</h1>
            <StatusBadge status={row.status} className="text-sm" />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[15px] text-muted-foreground">
            <span>{row.bar}</span>
            <span aria-hidden="true">/</span>
            <span>{row.alcoholType}</span>
            <AbcPill abc={row.abc} />
            <Badge variant="outline">{row.seriesClass.replace("intermittent-", "").replace(/^./, (c) => c.toUpperCase())} demand</Badge>
            {meta && Number.isFinite(meta.pctZeroDays) && <Badge variant="outline">{Math.round(meta.pctZeroDays * 100)}% zero-demand days</Badge>}
          </div>
        </div>
        <Button asChild variant="outline">
          <Link href={`/simulation?item=${row.id}`}>Replay in simulation</Link>
        </Button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.15fr]">
        <RecommendationPanel row={row} leadTime={DEFAULT_LEAD_TIME} />
        <div>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border bg-border shadow-panel sm:grid-cols-4">
            <Stat label="On hand" value={fmtVolume(row.onHand)} hint={row.asOf ? `Counted ${fmtDate(row.asOf, { day: "numeric", month: "short" })}` : undefined} />
            <Stat label="Forecast a day" value={fmtVolume(row.forecastPerDay)} />
            <Stat label="Par level" value={fmtVolume(row.par)} />
            <Stat label="Reorder point" value={fmtVolume(row.reorderPoint)} />
            <Stat label="Safety stock" value={fmtVolume(row.safetyStock)} />
            <Stat label="Lead-time demand" value={fmtVolume(row.leadTimeDemand)} />
            <Stat label="Cover" value={fmtDays(row.daysCover)} />
            <Stat label="Order now" value={row.orderQty > 0 ? fmtVolume(row.orderQty) : "None"} />
          </dl>
          <div className="mt-4 rounded-panel border bg-card p-4 shadow-panel">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">Stock against par</span>
              <span className="text-muted-foreground tabular-nums">
                {fmtVolume(row.onHand)} of {fmtVolume(row.par)}
              </span>
            </div>
            <StockGauge onHand={row.onHand} par={row.par} reorderPoint={row.reorderPoint} status={row.status} />
          </div>
        </div>
      </div>

      <DemandForecastChart id={row.id} />

      <div className="grid gap-6 lg:grid-cols-2">
        <ParBuild row={row} policy={policy} leadTime={DEFAULT_LEAD_TIME} />
        <ParLadder id={row.id} />
      </div>

      <ItemSimChart row={row} />
    </div>
  );
}
