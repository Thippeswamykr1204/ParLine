"use client";

import Link from "next/link";
import { ArrowUpRight, BadgeCheck } from "lucide-react";
import { useMemo } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "@/components/providers/app-provider";
import { AXIS_TICK, CHART, ChartTooltip, renderStockoutDot, shortDate } from "@/components/shared/chart-parts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BASELINE_POLICY } from "@/lib/config";
import type { InventoryRow } from "@/lib/engine/inventory";
import { POLICIES } from "@/lib/engine/policy";
import { checkParity, simulate } from "@/lib/engine/replay";
import { fmtVolume } from "@/lib/format";

export function ItemSimChart({ row }: { row: InventoryRow }) {
  const { ds, policy } = useApp();
  const run = useMemo(() => (ds ? simulate(ds, policy, row.id) : null), [ds, policy, row.id]);
  const base = useMemo(() => (ds ? simulate(ds, BASELINE_POLICY, row.id) : null), [ds, row.id]);
  const parity = useMemo(() => (ds ? checkParity(ds, policy, [row.id]) : null), [ds, policy, row.id]);
  if (!ds || !run || !base) return null;

  const data = run.days.map((d, i) => ({ date: d.date, onHand: d.onHand, baseline: base.days[i]?.onHand ?? null, stockout: d.stockout }));
  const s = run.summary;
  const b = base.summary;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>How this item would have run in the backtest</CardTitle>
          <CardDescription className="mt-1">
            Stock on hand each day under {POLICIES[policy].short} against the {fmtVolume(row.par)} par line, with the naive rule for comparison. Red dots are stockout days.
          </CardDescription>
        </div>
        <Link href={`/simulation?item=${row.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          Replay day by day
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full" role="img" aria-label="Simulated stock level versus par line for this item">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART.grid }} minTickGap={40} />
              <YAxis tickFormatter={(v: number) => fmtVolume(v)} tick={AXIS_TICK} tickLine={false} axisLine={false} width={58} />
              <Tooltip content={<ChartTooltip formatLabel={shortDate} formatValue={(v) => fmtVolume(v)} hide={["stockout"]} />} />
              {run.par !== null && <ReferenceLine y={run.par} stroke={CHART.par} strokeWidth={2} label={{ value: "Par", position: "insideTopRight", fill: CHART.parInk, fontSize: 12 }} />}
              <Line dataKey="baseline" name="Naive rule" type="linear" stroke={CHART.baseline} strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive animationDuration={800} />
              <Line dataKey="onHand" name={POLICIES[policy].short} type="linear" stroke={CHART.actual} strokeWidth={2} dot={renderStockoutDot} activeDot={{ r: 4 }} isAnimationActive animationDuration={1000} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Stockout days</dt>
            <dd className="font-semibold tabular-nums">
              {s.stockoutDays} <span className="text-xs font-normal text-muted-foreground">naive {b.stockoutDays}</span>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Lost volume</dt>
            <dd className="font-semibold tabular-nums">
              {fmtVolume(s.lostVolumeMl)} <span className="text-xs font-normal text-muted-foreground">naive {fmtVolume(b.lostVolumeMl)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Average holding</dt>
            <dd className="font-semibold tabular-nums">
              {fmtVolume(s.avgHoldingMl)} <span className="text-xs font-normal text-muted-foreground">naive {fmtVolume(b.avgHoldingMl)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Orders placed</dt>
            <dd className="font-semibold tabular-nums">
              {s.nOrders} <span className="text-xs font-normal text-muted-foreground">naive {b.nOrders}</span>
            </dd>
          </div>
        </dl>
        {parity?.ok && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-success">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
            This replay matches the Tier 4 results file for this item.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
