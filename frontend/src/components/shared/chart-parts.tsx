import type { ReactNode } from "react";
import { fmtDate } from "@/lib/format";

/** Chart palette. Navy = what happened, amber = the par line, blues/greys = models. */
export const CHART = {
  actual: "#12244A",
  par: "#F2A20C",
  parInk: "#B36F00",
  globalMl: "#3D63C9",
  rolling: "#8794AD",
  holt: "#1F9D8B",
  baseline: "#8794AD",
  critical: "#C42B43",
  success: "#1E8A5B",
  grid: "#E3E7EE",
  axis: "#5A6478",
  window: "#F2A20C",
} as const;

export const AXIS_TICK = { fontSize: 12, fill: CHART.axis } as const;

export function monthTick(date: string): string {
  return fmtDate(date, { month: "short" });
}
export function shortDate(date: string): string {
  return fmtDate(date, { day: "numeric", month: "short" });
}

interface TooltipEntry {
  name?: string | number;
  value?: number | string | null;
  color?: string;
  dataKey?: string | number;
}
export interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  formatLabel?: (label: string) => string;
  formatValue?: (v: number, key: string) => string;
  /** dataKeys to leave out of the tooltip. */
  hide?: string[];
  footer?: ReactNode;
}

export function ChartTooltip({ active, payload, label, formatLabel, formatValue, hide = [], footer }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload.filter((p) => p.value !== null && p.value !== undefined && !hide.includes(String(p.dataKey)));
  if (rows.length === 0) return null;
  const heading = label !== undefined ? (formatLabel ? formatLabel(String(label)) : String(label)) : "";
  return (
    <div className="min-w-[10rem] rounded-lg border bg-card px-3 py-2 text-[13px] shadow-lift">
      {heading && <div className="mb-1 font-medium">{heading}</div>}
      <ul className="space-y-0.5">
        {rows.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="font-medium tabular-nums">
              {typeof p.value === "number" && formatValue ? formatValue(p.value, String(p.dataKey)) : p.value}
            </span>
          </li>
        ))}
      </ul>
      {footer && <div className="mt-1.5 border-t pt-1.5 text-muted-foreground">{footer}</div>}
    </div>
  );
}

interface DotArgs {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: { stockout?: boolean };
}

/** Red marker on days the simulated bar ran out. Renders nothing elsewhere, including not-yet-played replay days. */
export function renderStockoutDot({ cx, cy, index, payload }: DotArgs) {
  if (!payload?.stockout || cx === undefined || cy === undefined || Number.isNaN(cy)) return <g key={`dot-${index}`} />;
  return <circle key={`dot-${index}`} cx={cx} cy={cy} r={4.5} fill={CHART.critical} stroke="#fff" strokeWidth={1.5} />;
}
