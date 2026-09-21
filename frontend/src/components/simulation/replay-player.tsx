"use client";

import { AlertTriangle, BadgeCheck, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "@/components/providers/app-provider";
import { AXIS_TICK, CHART, ChartTooltip, renderStockoutDot, shortDate } from "@/components/shared/chart-parts";
import { Segmented } from "@/components/shared/segmented";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { BASELINE_POLICY, DEFAULT_LEAD_TIME } from "@/lib/config";
import { POLICIES } from "@/lib/engine/policy";
import { checkParity, portfolioCurve, simulate } from "@/lib/engine/replay";
import type { SimResult } from "@/lib/engine/simulate";
import { fmtDate, fmtInt, fmtVolume, shortBar } from "@/lib/format";
import { cn } from "@/lib/utils";

type Mode = "item" | "all";
type Speed = "1" | "2" | "4";

interface EventRow {
  day: number;
  date: string;
  kind: "order" | "delivery" | "stockout";
  text: string;
}

function buildEvents(run: SimResult, cursor: number, leadTime: number): EventRow[] {
  const out: EventRow[] = [];
  for (let i = 0; i < cursor; i++) {
    const d = run.days[i];
    if (d.received > 0) out.push({ day: d.day, date: d.date, kind: "delivery", text: `${fmtVolume(d.received)} delivered` });
    if (d.orderQty > 0) out.push({ day: d.day, date: d.date, kind: "order", text: `Ordered ${fmtVolume(d.orderQty)}, arrives day ${d.day + leadTime}` });
    if (d.stockout) out.push({ day: d.day, date: d.date, kind: "stockout", text: `Ran out, lost ${fmtVolume(d.lost)}` });
  }
  return out;
}

const EVENT_DOT: Record<EventRow["kind"], string> = { order: "bg-accent", delivery: "bg-success", stockout: "bg-critical" };

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bad" }) {
  return (
    <div>
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className={cn("font-display text-2xl font-semibold leading-tight tabular-nums", tone === "bad" && "text-critical")}>{value}</dd>
      {sub && <dd className="text-xs text-muted-foreground tabular-nums">{sub}</dd>}
    </div>
  );
}

export function ReplayPlayer({ initialItem }: { initialItem: string | null }) {
  const { ds, policy, rows } = useApp();
  const [mode, setMode] = useState<Mode>("item");
  const [itemId, setItemId] = useState<string | null>(initialItem);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>("1");

  const n = ds?.validationDates.length ?? 0;

  // Default to the item the naive rule struggled with most, which makes the contrast visible immediately.
  const defaultItem = useMemo(() => {
    if (!ds) return null;
    const base = ds.simKpis.get(BASELINE_POLICY);
    let best: string | null = null;
    let worst = -1;
    for (const r of rows.length ? rows : ds.series) {
      const d = base?.get(r.id)?.stockoutDays ?? 0;
      if (d > worst) {
        worst = d;
        best = r.id;
      }
    }
    return best;
  }, [ds, rows]);
  const activeItem = itemId && ds?.seriesById.has(itemId) ? itemId : defaultItem;

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setCursor((c) => Math.min(c + 1, n)), 240 / Number(speed));
    return () => clearInterval(t);
  }, [playing, speed, n]);
  useEffect(() => {
    if (playing && cursor >= n && n > 0) setPlaying(false);
  }, [playing, cursor, n]);

  const run = useMemo(() => (ds && activeItem ? simulate(ds, policy, activeItem) : null), [ds, policy, activeItem]);
  const base = useMemo(() => (ds && activeItem ? simulate(ds, BASELINE_POLICY, activeItem) : null), [ds, activeItem]);
  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const curve = useMemo(() => (ds ? portfolioCurve(ds, policy, ids) : []), [ds, policy, ids]);
  const baseCurve = useMemo(() => (ds ? portfolioCurve(ds, BASELINE_POLICY, ids) : []), [ds, ids]);
  const parity = useMemo(() => (ds ? checkParity(ds, policy) : null), [ds, policy]);

  const events = useMemo(() => (run ? buildEvents(run, cursor, DEFAULT_LEAD_TIME) : []), [run, cursor]);

  if (!ds || n === 0) return <Skeleton className="h-[34rem] w-full rounded-panel" />;

  const restart = () => {
    setCursor(0);
    setPlaying(true);
  };
  const togglePlay = () => {
    if (cursor >= n) restart();
    else setPlaying((p) => !p);
  };

  // ---- chart data --------------------------------------------------------------------------------------------------
  let chart: ReactNode = null;
  let stats: ReactNode = null;
  let dayLabel = "Before day 1";
  const current = cursor > 0 ? ds.validationDates[cursor - 1] : null;
  if (current) dayLabel = `Day ${cursor} of ${n}, ${fmtDate(current, { day: "numeric", month: "short" })}`;

  if (mode === "item" && run && base) {
    const data = run.days.map((d, i) => ({
      date: d.date,
      onHand: i < cursor ? d.onHand : null,
      baseline: i < cursor ? base.days[i].onHand : null,
      stockout: i < cursor && d.stockout,
    }));
    const yMax = Math.max(run.par ?? 0, ...run.days.map((d) => d.onHand), ...base.days.map((d) => d.onHand)) * 1.1 || 1;
    const upto = run.days.slice(0, cursor);
    const baseUpto = base.days.slice(0, cursor);
    const now = upto[upto.length - 1];
    const so = upto.filter((d) => d.stockout).length;
    const bso = baseUpto.filter((d) => d.stockout).length;
    const lost = upto.reduce((a, d) => a + d.lost, 0);
    const blost = baseUpto.reduce((a, d) => a + d.lost, 0);
    const orders = upto.filter((d) => d.orderQty > 0).length;

    chart = (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART.grid }} minTickGap={36} />
          <YAxis domain={[0, yMax]} allowDataOverflow tickFormatter={(v: number) => fmtVolume(v)} tick={AXIS_TICK} tickLine={false} axisLine={false} width={58} />
          <Tooltip content={<ChartTooltip formatLabel={shortDate} formatValue={(v) => fmtVolume(v)} hide={["stockout"]} />} />
          {run.par !== null && <ReferenceLine y={run.par} stroke={CHART.par} strokeWidth={2} label={{ value: "Par line", position: "insideTopRight", fill: CHART.parInk, fontSize: 12 }} />}
          {current && <ReferenceLine x={current} stroke={CHART.actual} strokeOpacity={0.35} strokeDasharray="3 3" />}
          <Line dataKey="baseline" name="Naive rule" type="linear" stroke={CHART.baseline} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls={false} />
          <Line dataKey="onHand" name={POLICIES[policy].short} type="linear" stroke={CHART.actual} strokeWidth={2.25} dot={renderStockoutDot} isAnimationActive={false} connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
    );
    stats = (
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Stat label="On hand now" value={now ? fmtVolume(now.onHand) : "n/a"} sub={now ? `${fmtVolume(now.inTransit)} on the way` : undefined} />
        <Stat label="Orders placed" value={fmtInt(orders)} />
        <Stat label="Stockout days" value={fmtInt(so)} sub={`Naive rule ${fmtInt(bso)}`} tone={so > 0 ? "bad" : undefined} />
        <Stat label="Lost volume" value={fmtVolume(lost)} sub={`Naive rule ${fmtVolume(blost)}`} />
      </dl>
    );
  } else if (mode === "all" && curve.length && baseCurve.length) {
    const data = curve.map((p, i) => ({
      date: p.date,
      policy: i < cursor ? p.cumStockouts : null,
      baseline: i < cursor ? baseCurve[i].cumStockouts : null,
    }));
    const yMax = Math.max(baseCurve[baseCurve.length - 1].cumStockouts, curve[curve.length - 1].cumStockouts, 1) * 1.05;
    const p = cursor > 0 ? curve[cursor - 1] : null;
    const b = cursor > 0 ? baseCurve[cursor - 1] : null;
    chart = (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART.grid }} minTickGap={36} />
          <YAxis domain={[0, yMax]} allowDataOverflow tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
          <Tooltip content={<ChartTooltip formatLabel={shortDate} formatValue={(v) => fmtInt(v)} />} />
          {current && <ReferenceLine x={current} stroke={CHART.actual} strokeOpacity={0.35} strokeDasharray="3 3" />}
          <Line dataKey="baseline" name="Naive rule" type="monotone" stroke={CHART.baseline} strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls={false} />
          <Line dataKey="policy" name={POLICIES[policy].short} type="monotone" stroke={CHART.par} strokeWidth={3} dot={false} isAnimationActive={false} connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
    );
    stats = (
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Stat label="Stockout days so far" value={p ? fmtInt(p.cumStockouts) : "0"} sub={`Naive rule ${b ? fmtInt(b.cumStockouts) : 0}`} tone={p && p.cumStockouts > 0 ? "bad" : undefined} />
        <Stat label="Lost volume so far" value={p ? fmtVolume(p.cumLostMl) : "0 ml"} sub={`Naive rule ${b ? fmtVolume(b.cumLostMl) : "0 ml"}`} />
        <Stat label="Items out today" value={p ? fmtInt(p.stockedOutSeries) : "0"} sub={`Naive rule ${b ? fmtInt(b.stockedOutSeries) : 0} of ${ids.length}`} />
        <Stat label="Stock held now" value={p ? fmtVolume(p.onHandMl) : "n/a"} sub={b ? `Naive rule ${fmtVolume(b.onHandMl)}` : undefined} />
      </dl>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b p-4">
        <Segmented
          ariaLabel="Replay scope"
          size="sm"
          value={mode}
          onChange={(m) => {
            setMode(m);
            setCursor(0);
            setPlaying(false);
          }}
          options={[
            { value: "item", label: "One item" },
            { value: "all", label: `All ${ids.length} items` },
          ]}
        />
        {mode === "item" && activeItem && (
          <Select
            value={activeItem}
            onValueChange={(v) => {
              setItemId(v);
              setCursor(0);
              setPlaying(false);
            }}
          >
            <SelectTrigger className="w-[15rem]" aria-label="Item to replay">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ds.series.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.brand}, {shortBar(s.bar)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          {parity &&
            (parity.ok ? (
              <span className="inline-flex items-center gap-1.5 text-success" title="The in-browser replay reproduces tier4_perseries results for every item under this policy">
                <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                Matches Tier 4 results ({parity.checked}/{ds.series.length} items)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-critical">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                {parity.mismatches.length} items differ from the Tier 4 results file
              </span>
            ))}
        </div>
      </div>

      <CardContent className="grid gap-6 p-5 lg:grid-cols-[1.9fr_1fr]">
        <div>
          <div className="h-[22rem] w-full" role="img" aria-label="Replay chart: simulated stock level against the par line, day by day">
            {chart}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <Button size="icon" variant="default" onClick={togglePlay} aria-label={playing ? "Pause replay" : cursor >= n ? "Replay from the start" : "Play replay"}>
              {playing ? <Pause /> : cursor >= n ? <RotateCcw /> : <Play />}
            </Button>
            <div className="flex-1">
              <input
                type="range"
                min={0}
                max={n}
                step={1}
                value={cursor}
                className="scrubber"
                style={{ ["--fill" as string]: `${(cursor / n) * 100}%` }}
                aria-label="Replay position in days"
                aria-valuetext={dayLabel}
                onChange={(e) => {
                  setPlaying(false);
                  setCursor(Number(e.target.value));
                }}
              />
            </div>
            <Segmented ariaLabel="Playback speed" size="sm" value={speed} onChange={setSpeed} options={[{ value: "1", label: "1x" }, { value: "2", label: "2x" }, { value: "4", label: "4x" }]} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
            {dayLabel}
          </p>
        </div>

        <div className="flex flex-col gap-5 lg:border-l lg:pl-6">
          {stats}
          {mode === "item" && (
            <div className="min-h-0 flex-1">
              <h3 className="mb-2 text-sm font-semibold">What happened</h3>
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">Press play to step through orders, deliveries and stockouts.</p>
              ) : (
                <ol className="max-h-56 space-y-1.5 overflow-y-auto pr-1 text-sm scrollbar-thin" aria-live="polite">
                  {[...events].reverse().slice(0, 12).map((e, i) => (
                    <li key={`${e.day}-${e.kind}-${i}`} className="flex items-start gap-2">
                      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", EVENT_DOT[e.kind])} aria-hidden="true" />
                      <span className="text-muted-foreground tabular-nums">Day {e.day}</span>
                      <span>{e.text}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
