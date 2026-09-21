import { BASELINE_POLICY, DEFAULT_LEAD_TIME } from "../config";
import type { Dataset, PolicyId, SimSeriesKpi } from "../types";
import { POLICIES, policyParams } from "./policy";
import { simulateSeries, type SimResult } from "./simulate";

const cache = new WeakMap<Dataset, Map<string, SimResult>>();

/**
 * Runs (or returns the cached) backtest for one series under one policy.
 * Demand stream = actual consumption over the Tier 2 validation window, exactly as in Tier 4.
 */
export function simulate(ds: Dataset, policy: PolicyId, id: string, leadTime = DEFAULT_LEAD_TIME): SimResult | null {
  let m = cache.get(ds);
  if (!m) {
    m = new Map();
    cache.set(ds, m);
  }
  const key = `${policy}|${leadTime}|${id}`;
  const hit = m.get(key);
  if (hit) return hit;

  const pts = ds.validation.get(id);
  const inputs = ds.inputs.get(id);
  if (!pts || !inputs || pts.length === 0) return null;
  const def = POLICIES[policy];
  const p = policyParams(def, inputs, leadTime);
  const demand = pts.map((x) => x.actual);
  const dates = pts.map((x) => x.date);
  const res =
    def.kind === "fixed"
      ? simulateSeries(demand, dates, { leadTime, reorderPoint: p.reorderPoint, fixedOrderQty: p.fixedOrderQty })
      : simulateSeries(demand, dates, { leadTime, reorderPoint: p.reorderPoint, par: p.par });
  m.set(key, res);
  return res;
}

export interface PortfolioPoint {
  day: number;
  date: string;
  cumStockouts: number;
  cumLostMl: number;
  cumOrders: number;
  onHandMl: number;
  stockedOutSeries: number;
}

/** Day-by-day roll-up across a set of series (used by the simulation replay and the dashboard verdict). */
export function portfolioCurve(ds: Dataset, policy: PolicyId, ids: string[], leadTime = DEFAULT_LEAD_TIME): PortfolioPoint[] {
  const runs = ids.map((id) => simulate(ds, policy, id, leadTime)).filter((r): r is SimResult => r !== null);
  if (runs.length === 0) return [];
  const n = runs[0].days.length;
  const out: PortfolioPoint[] = new Array(n);
  let cumS = 0;
  let cumL = 0;
  let cumO = 0;
  for (let i = 0; i < n; i++) {
    let onHand = 0;
    let stockedOut = 0;
    for (const r of runs) {
      const d = r.days[i];
      if (!d) continue;
      onHand += d.onHand;
      if (d.stockout) {
        stockedOut += 1;
        cumL += d.lost;
      }
      if (d.orderQty > 0) cumO += 1;
    }
    cumS += stockedOut;
    out[i] = { day: i + 1, date: runs[0].days[i].date, cumStockouts: cumS, cumLostMl: cumL, cumOrders: cumO, onHandMl: onHand, stockedOutSeries: stockedOut };
  }
  return out;
}

export interface ParityResult {
  ok: boolean;
  checked: number;
  mismatches: string[];
}

const close = (a: number, b: number) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));

/** Compares the in-browser replay with the verified Tier 4 per-series CSV for the given policy. */
export function checkParity(ds: Dataset, policy: PolicyId, ids?: string[]): ParityResult {
  const ref = ds.simKpis.get(policy);
  const targets = ids ?? ds.series.map((s) => s.id);
  const mismatches: string[] = [];
  let checked = 0;
  for (const id of targets) {
    const r = simulate(ds, policy, id);
    const k: SimSeriesKpi | undefined = ref?.get(id);
    if (!r || !k) continue;
    checked += 1;
    const s = r.summary;
    const bad =
      s.stockoutDays !== k.stockoutDays ||
      s.nOrders !== k.nOrders ||
      !close(s.lostVolumeMl, k.lostVolumeMl) ||
      !close(s.avgHoldingMl, k.avgHoldingMl) ||
      !close(s.turnover, k.turnover);
    if (bad) mismatches.push(id);
  }
  return { ok: checked > 0 && mismatches.length === 0, checked, mismatches };
}

export { BASELINE_POLICY };
