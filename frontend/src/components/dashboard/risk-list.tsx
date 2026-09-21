"use client";

import Link from "next/link";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { useApp } from "@/components/providers/app-provider";
import { StatusBadge } from "@/components/shared/status";
import { StockGauge } from "@/components/shared/stock-gauge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { sortByUrgency } from "@/lib/engine/inventory";
import { fmtDays, fmtVolume, shortBar } from "@/lib/format";

export function RiskList() {
  const { ds, rows, kpis } = useApp();
  const top = useMemo(() => sortByUrgency(rows.filter((r) => r.status === "out" || r.status === "risk")).slice(0, 6), [rows]);

  if (!ds || !kpis) return <Skeleton className="h-[26rem] w-full rounded-panel" />;

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>Top stockout risks</CardTitle>
        <CardDescription>Least cover first, measured against each item&apos;s reorder point.</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {top.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center">
            <ShieldCheck className="h-8 w-8 text-success" aria-hidden="true" />
            <p className="font-medium">Nothing is below its reorder point</p>
            <p className="max-w-[16rem] text-sm text-muted-foreground">Every item in this view has more on hand than the policy would reorder at.</p>
          </div>
        ) : (
          <ul className="-mx-2 divide-y">
            {top.map((r) => (
              <li key={r.id}>
                <Link href={`/items/${r.id}`} className="group block rounded-lg px-2 py-3 transition-colors hover:bg-muted/70">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{r.brand}</div>
                      <div className="text-[13px] text-muted-foreground">{shortBar(r.bar)}</div>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                  <StockGauge className="mt-2.5" onHand={r.onHand} par={r.par} reorderPoint={r.reorderPoint} status={r.status} scale={2} />
                  <div className="mt-1.5 flex justify-between text-xs text-muted-foreground tabular-nums">
                    <span>
                      {fmtVolume(r.onHand)} of {fmtVolume(r.par)} par
                    </span>
                    <span>{r.daysCover === 0 ? "No cover" : `${fmtDays(r.daysCover)} of cover`}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {kpis.atRiskCount > 0 && (
        <div className="border-t px-5 py-3 text-sm">
          <Link href="/inventory?status=risk" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            See all {kpis.atRiskCount} at-risk items
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      )}
    </Card>
  );
}
