import type { Dataset, ModelKey } from "../types";

export interface TrendPoint {
  date: string;
  actual: number;
  avg7: number;
  /** Forecasts exist only inside the Tier 2 validation window. */
  global_ml: number | null;
  rolling_mean_7: number | null;
  holt_winters: number | null;
  inValidation: boolean;
}

function trailingMean(values: number[], window: number): number[] {
  const out = new Array<number>(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    out[i] = sum / Math.min(i + 1, window);
  }
  return out;
}

function buildTrend(ds: Dataset, ids: string[]): TrendPoint[] {
  const n = ds.historyDates.length;
  const totals = new Array<number>(n).fill(0);
  for (const id of ids) {
    const h = ds.history.get(id);
    if (!h) continue;
    for (let i = 0; i < n; i++) totals[i] += h[i];
  }
  const avg = trailingMean(totals, 7);

  const fc: Record<ModelKey, Map<string, number>> = {
    seasonal_naive: new Map(),
    rolling_mean_7: new Map(),
    holt_winters: new Map(),
    global_ml: new Map(),
  };
  for (const id of ids) {
    for (const p of ds.validation.get(id) ?? []) {
      (Object.keys(fc) as ModelKey[]).forEach((k) => fc[k].set(p.date, (fc[k].get(p.date) ?? 0) + p.preds[k]));
    }
  }
  const valStart = ds.validationDates[0];
  return ds.historyDates.map((date, i) => {
    const inVal = valStart !== undefined && date >= valStart;
    return {
      date,
      actual: totals[i],
      avg7: avg[i],
      global_ml: inVal ? fc.global_ml.get(date) ?? null : null,
      rolling_mean_7: inVal ? fc.rolling_mean_7.get(date) ?? null : null,
      holt_winters: inVal ? fc.holt_winters.get(date) ?? null : null,
      inValidation: inVal,
    };
  });
}

/** Total daily demand across all series (or one bar), with forecast overlays in the validation window. */
export function demandTrend(ds: Dataset, bar: string): TrendPoint[] {
  const ids = ds.series.filter((s) => bar === "all" || s.bar === bar).map((s) => s.id);
  return buildTrend(ds, ids);
}

/** Same shape for a single bar x brand. */
export function seriesTrend(ds: Dataset, id: string): TrendPoint[] {
  return buildTrend(ds, [id]);
}

export function barLabel(bar: string): string {
  return bar === "all" ? "all bars" : bar;
}
