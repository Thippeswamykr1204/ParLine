"use client";

import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "@/components/providers/app-provider";
import { AXIS_TICK, CHART, ChartTooltip, shortDate } from "@/components/shared/chart-parts";
import { Segmented } from "@/components/shared/segmented";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { demandTrend, barLabel } from "@/lib/engine/aggregate";
import { fmtVolume } from "@/lib/format";

type Range = "year" | "window";

const NAMES: Record<string, string> = {
  actual: "Daily demand",
  avg7: "7-day average",
  global_ml: "Global ML forecast",
  rolling_mean_7: "Rolling mean forecast",
};

export function DemandTrendChart() {
  const { ds, bar } = useApp();
  const [range, setRange] = useState<Range>("year");
  const all = useMemo(() => (ds ? demandTrend(ds, bar) : []), [ds, bar]);
  const data = useMemo(() => (range === "window" ? all.filter((p) => p.inValidation) : all), [all, range]);

  if (!ds) return <Skeleton className="h-[26rem] w-full rounded-panel" />;

  const start = ds.validationDates[0];
  const end = ds.validationDates[ds.validationDates.length - 1];
  const total = data.reduce((a, p) => a + p.actual, 0);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Demand across {barLabel(bar)}</CardTitle>
          <CardDescription className="mt-1">
            {fmtVolume(total)} poured in this view. Forecasts exist only inside the backtest window; the models were trained on the days before it.
          </CardDescription>
        </div>
        <Segmented
          ariaLabel="Chart range"
          size="sm"
          value={range}
          onChange={setRange}
          options={[
            { value: "year", label: "Full year" },
            { value: "window", label: "Backtest window" },
          ]}
        />
      </CardHeader>
      <CardContent>
        <div className="h-[19rem] w-full" role="img" aria-label={`Daily demand for ${barLabel(bar)} with 7-day average and forecasts in the backtest window`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART.grid }} minTickGap={48} />
              <YAxis tickFormatter={(v: number) => fmtVolume(v)} tick={AXIS_TICK} tickLine={false} axisLine={false} width={58} />
              {range === "year" && <ReferenceArea x1={start} x2={end} fill={CHART.window} fillOpacity={0.09} strokeOpacity={0} ifOverflow="visible" />}
              <Tooltip
                cursor={{ stroke: CHART.axis, strokeDasharray: "3 3" }}
                content={<ChartTooltip formatLabel={(l) => shortDate(l)} formatValue={(v) => fmtVolume(v)} />}
              />
              <Area dataKey="actual" name={NAMES.actual} type="monotone" stroke="none" fill={CHART.actual} fillOpacity={0.1} isAnimationActive animationDuration={900} />
              <Line dataKey="avg7" name={NAMES.avg7} type="monotone" stroke={CHART.actual} strokeWidth={2} dot={false} isAnimationActive animationDuration={1100} />
              <Line dataKey="global_ml" name={NAMES.global_ml} type="monotone" stroke={CHART.globalMl} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive animationDuration={1100} />
              <Line dataKey="rolling_mean_7" name={NAMES.rolling_mean_7} type="monotone" stroke={CHART.rolling} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls={false} isAnimationActive animationDuration={1100} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted-foreground">
          <Legend color={CHART.actual} label="7-day average" />
          <Legend color={CHART.globalMl} label="Global ML forecast" />
          <Legend color={CHART.rolling} label="Rolling mean forecast" dashed />
          {range === "year" && <Legend color={CHART.window} label="Backtest window" swatch />}
        </ul>
      </CardContent>
    </Card>
  );
}

function Legend({ color, label, dashed, swatch }: { color: string; label: string; dashed?: boolean; swatch?: boolean }) {
  return (
    <li className="flex items-center gap-1.5">
      {swatch ? (
        <span className="h-3 w-4 rounded-sm" style={{ background: color, opacity: 0.3 }} />
      ) : (
        <span className="w-4 border-t-2" style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }} />
      )}
      {label}
    </li>
  );
}
