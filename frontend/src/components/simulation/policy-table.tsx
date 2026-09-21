"use client";

import { useMemo } from "react";
import { useApp } from "@/components/providers/app-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { policyTotalsFor } from "@/lib/engine/inventory";
import { POLICIES, POLICY_IDS } from "@/lib/engine/policy";
import { fmt1, fmtInt, fmtVolume } from "@/lib/format";
import { cn } from "@/lib/utils";

export function PolicyTable() {
  const { ds, rows, policy } = useApp();
  const list = useMemo(() => {
    if (!ds) return [];
    const ids = rows.map((r) => r.id);
    return POLICY_IDS.map((id) => ({ id, t: policyTotalsFor(ds, ids, id) })).sort((a, b) => a.t.stockoutDays - b.t.stockoutDays);
  }, [ds, rows]);

  if (!ds || list.length === 0) return <Skeleton className="h-72 w-full rounded-panel" />;
  const worst = Math.max(...list.map((x) => x.t.stockoutDays), 1);
  const naive = list.find((x) => x.id === "naive");

  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Every policy, same demand</CardTitle>
          <CardDescription>Each policy was replayed against the same {ds.validationDates.length} days of real consumption. Fewest stockout days first.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-left text-[13px] text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Policy</th>
                  <th className="px-3 py-2 font-medium">Stockout days</th>
                  <th className="px-3 py-2 text-right font-medium">Lost volume</th>
                  <th className="px-3 py-2 text-right font-medium">Avg held per item</th>
                  <th className="px-3 py-2 text-right font-medium">Turnover</th>
                  <th className="pl-3 py-2 text-right font-medium">Orders</th>
                </tr>
              </thead>
              <tbody>
                {list.map((x, i) => (
                  <tr key={x.id} className={cn("border-b last:border-0", x.id === policy && "bg-accent/10")}>
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-2 font-medium">
                        {POLICIES[x.id].short}
                        {i === 0 && <Badge variant="success">Fewest stockouts</Badge>}
                        {x.id === policy && <Badge variant="outline">Selected</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-9 tabular-nums font-medium">{fmtInt(x.t.stockoutDays)}</span>
                        <div className="h-2 w-28 rounded-full bg-muted">
                          <div className={cn("h-full rounded-full", i === 0 ? "bg-success" : "bg-primary/40")} style={{ width: `${(x.t.stockoutDays / worst) * 100}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmtVolume(x.t.lostVolumeMl)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmtVolume(x.t.avgHoldingMl)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmt1(x.t.avgTurnover)}</td>
                    <td className="pl-3 py-3 text-right tabular-nums">{fmtInt(x.t.orders)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {naive && <p className="mt-3 text-[13px] text-muted-foreground">The naive rule holds the least stock but loses the most volume. Better policies trade extra stock for fewer empty shelves.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What a slower supplier costs</CardTitle>
          <CardDescription>Global ML at 99%, tuned and re-simulated at each lead time, across all items.</CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[13px] text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Lead time</th>
                <th className="px-3 py-2 text-right font-medium">Stockout days</th>
                <th className="pl-3 py-2 text-right font-medium">Avg held</th>
              </tr>
            </thead>
            <tbody>
              {ds.leadTimeSensitivity.map((r) => (
                <tr key={r.leadTimeDays} className="border-b last:border-0">
                  <td className="py-3 pr-3 font-medium">{r.leadTimeDays} days</td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmtInt(r.totalStockoutDays)}</td>
                  <td className="pl-3 py-3 text-right tabular-nums">{fmtVolume(r.avgHoldingMlPerSeries)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            Longer deliveries raise par levels, so bars hold more stock to keep service. Each extra day of lead time ties up more of the shelf.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
