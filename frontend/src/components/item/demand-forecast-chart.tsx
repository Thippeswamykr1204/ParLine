"use client";

import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "@/components/providers/app-provider";
import { AXIS_TICK, CHART, ChartTooltip, shortDate } from "@/components/shared/chart-parts";
import { Segmented } from "@/components/shared/segmented";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { seriesTrend } from "@/lib/engine/aggregate";
import { fmtVolume } from "@/lib/format";
import type { ModelKey } from "@/lib/types";
import { cn } from "@/lib/utils";

type ShownModel = Extract<ModelKey, "global_ml" | "rolling_mean_7" | "holt_winters">;
const MODELS: Array<{ key: ShownModel; label: string; color: string; dashed?: boolean }> = [
  { key: "global_ml", label: "Global ML", color: CHART.globalMl },
  { key: "rolling_mean_7", label: "Rolling mean (7 day)", color: CHART.rolling, dashed: true },
  { key: "holt_winters", label: "Holt-Winters", color: CHART.holt },
];

export function DemandForecastChart({ id }: { id: string }) {
  const { ds } = useApp();
  const [range, setRange] = useState<"year" | "window">("window");
  const [on, setOn] = useState<Record<ShownModel, boolean>>({ global_ml: true, rolling_mean_7: true, holt_winters: false });

  const all = useMemo(() => (ds ? seriesTrend(ds, id) : []), [ds, id]);
  const data = useMemo(() => (range === "window" ? all.filter((p) => p.inValidation) : all), [all, range]);
  const wape = useMemo(() => {
    const pts = ds?.validation.get(id) ?? [];
    const total = pts.reduce((a, p) => a + p.actual, 0);
    const out = {} as Record<ShownModel, number>;
    for (const m of MODELS) out[m.key] = total > 0 ? pts.reduce((a, p) => a + Math.abs(p.actual - p.preds[m.key]), 0) / total : NaN;
    return out;
  }, [ds, id]);

  if (!ds) return null;
  const start = ds.validationDates[0];
  const end = ds.validationDates[ds.validationDates.length - 1];

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Demand history and forecast</CardTitle>
          <CardDescription className="mt-1">Most days pour nothing, so bars are sparse. The line is the 7-day average.</CardDescription>
        </div>
        <Segmented
          ariaLabel="Chart range"
          size="sm"
          value={range}
          onChange={setRange}
          options={[
            { value: "window", label: "Backtest window" },
            { value: "year", label: "Full year" },
          ]}
        />
      </CardHeader>
      <CardContent>
        <div className="h-72 w-full" role="img" aria-label="Daily demand for this item with forecast overlays">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART.grid }} minTickGap={48} />
              <YAxis tickFormatter={(v: number) => fmtVolume(v)} tick={AXIS_TICK} tickLine={false} axisLine={false} width={58} />
              {range === "year" && <ReferenceArea x1={start} x2={end} fill={CHART.window} fillOpacity={0.09} strokeOpacity={0} ifOverflow="visible" />}
              <Tooltip cursor={{ fill: "rgba(18,36,74,0.05)" }} content={<ChartTooltip formatLabel={shortDate} formatValue={(v) => fmtVolume(v)} />} />
              <Bar dataKey="actual" name="Poured" fill={CHART.actual} fillOpacity={0.55} radius={[2, 2, 0, 0]} maxBarSize={10} isAnimationActive animationDuration={800} />
              <Line dataKey="avg7" name="7-day average" type="monotone" stroke={CHART.actual} strokeWidth={2} dot={false} isAnimationActive animationDuration={1000} />
              {MODELS.filter((m) => on[m.key]).map((m) => (
                <Line
                  key={m.key}
                  dataKey={m.key}
                  name={`${m.label} forecast`}
                  type="monotone"
                  stroke={m.color}
                  strokeWidth={2}
                  strokeDasharray={m.dashed ? "4 3" : undefined}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive
                  animationDuration={800}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm text-muted-foreground">Overlay forecast:</span>
          {MODELS.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={on[m.key]}
              onClick={() => setOn((s) => ({ ...s, [m.key]: !s[m.key] }))}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-sm transition-colors",
                on[m.key] ? "border-primary/30 bg-secondary font-medium" : "bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: m.color }} aria-hidden="true" />
              {m.label}
              <span className="text-xs tabular-nums text-muted-foreground">{Number.isFinite(wape[m.key]) ? `WAPE ${wape[m.key].toFixed(2)}` : "n/a"}</span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
