import { STATUS_RULES, BASELINE_POLICY, DEFAULT_LEAD_TIME } from "../config";
import { daysBetween, fmtDays, fmtVolume, shortBar } from "../format";
import type { AbcClass, Dataset, PolicyId, SimSeriesKpi, Status } from "../types";
import { POLICIES, policyParams } from "./policy";

export interface InventoryOptions {
  policy: PolicyId;
  overstockMultiple: number;
  leadTime?: number;
}

export interface InventoryRow {
  id: string;
  bar: string;
  brand: string;
  alcoholType: string;
  abc: AbcClass;
  seriesClass: string;
  /** Latest observed ledger closing balance (ml). */
  onHand: number;
  asOf: string | null;
  readingAgeDays: number | null;
  stale: boolean;
  forecastPerDay: number;
  rmse: number;
  leadTimeDemand: number;
  safetyStock: number;
  par: number;
  reorderPoint: number;
  /** on-hand / forecast per day; null when the policy forecasts no demand. */
  daysCover: number | null;
  /** days until on-hand is expected to fall to the reorder point. */
  daysToReorder: number | null;
  status: Status;
  /** Recommended order now (0 if none). Assumes nothing is in transit: the ledger has no purchase-order feed. */
  orderQty: number;
  /** Volume held above the par level. */
  excessQty: number;
  fixedPolicy: boolean;
  sim: SimSeriesKpi | null;
  baselineSim: SimSeriesKpi | null;
}

export const STATUS_ORDER: Record<Status, number> = { out: 0, risk: 1, low: 2, healthy: 3, over: 4 };

export function classify(onHand: number, par: number, rop: number, forecast: number, overstockMultiple: number): Status {
  if (par <= 0 || forecast <= 0) return onHand > 0 ? "over" : "healthy";
  if (onHand <= 0) return "out";
  if (onHand < rop) return "risk";
  if (onHand < STATUS_RULES.lowMultiple * rop) return "low";
  if (onHand >= overstockMultiple * par) return "over";
  return "healthy";
}

export function buildRows(ds: Dataset, opts: InventoryOptions): InventoryRow[] {
  const L = opts.leadTime ?? DEFAULT_LEAD_TIME;
  const def = POLICIES[opts.policy];
  const simMap = ds.simKpis.get(opts.policy);
  const baseMap = ds.simKpis.get(BASELINE_POLICY);
  const rows: InventoryRow[] = [];

  for (const s of ds.series) {
    const inputs = ds.inputs.get(s.id);
    if (!inputs) continue;
    const p = policyParams(def, inputs, L);
    const reading = ds.ledger.get(s.id) ?? null;
    const onHand = reading ? reading.closing : 0;
    const age = reading ? daysBetween(reading.date, ds.asOf) : null;
    const status = classify(onHand, p.par, p.reorderPoint, p.forecastPerDay, opts.overstockMultiple);

    let orderQty = 0;
    if (status === "out" || status === "risk") {
      orderQty = p.fixedOrderQty !== null ? p.fixedOrderQty : Math.max(p.par - onHand, 0);
    }
    const f = p.forecastPerDay;
    rows.push({
      id: s.id,
      bar: s.bar,
      brand: s.brand,
      alcoholType: s.alcoholType,
      abc: s.abc,
      seriesClass: s.seriesClass,
      onHand,
      asOf: reading?.date ?? null,
      readingAgeDays: age,
      stale: age === null || age > STATUS_RULES.staleDays,
      forecastPerDay: f,
      rmse: p.rmse,
      leadTimeDemand: p.leadTimeDemand,
      safetyStock: p.safetyStock,
      par: p.par,
      reorderPoint: p.reorderPoint,
      daysCover: f > 0 ? onHand / f : null,
      daysToReorder: f > 0 ? Math.max((onHand - p.reorderPoint) / f, 0) : null,
      status,
      orderQty,
      excessQty: Math.max(onHand - p.par, 0),
      fixedPolicy: def.kind === "fixed",
      sim: simMap?.get(s.id) ?? null,
      baselineSim: baseMap?.get(s.id) ?? null,
    });
  }
  return rows;
}

/** Worst first: status severity, then least cover, then highest demand. */
export function sortByUrgency(rows: InventoryRow[]): InventoryRow[] {
  return [...rows].sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s !== 0) return s;
    const ac = a.daysCover ?? Infinity;
    const bc = b.daysCover ?? Infinity;
    if (ac !== bc) return ac - bc;
    return b.forecastPerDay - a.forecastPerDay;
  });
}

export function scopeRows(rows: InventoryRow[], bar: string): InventoryRow[] {
  return bar === "all" ? rows : rows.filter((r) => r.bar === bar);
}

// ---------------------------------------------------------------------------------------------------------------
// Portfolio KPIs
// ---------------------------------------------------------------------------------------------------------------
export interface SimTotals {
  stockoutDays: number;
  lostVolumeMl: number;
  avgHoldingMl: number;
  avgTurnover: number;
  orders: number;
  days: number;
}

function totalsOf(list: Array<SimSeriesKpi | null | undefined>): SimTotals {
  let stockoutDays = 0;
  let lost = 0;
  let hold = 0;
  let turn = 0;
  let turnN = 0;
  let orders = 0;
  let days = 0;
  let n = 0;
  for (const k of list) {
    if (!k) continue;
    n += 1;
    stockoutDays += k.stockoutDays;
    lost += k.lostVolumeMl;
    hold += k.avgHoldingMl;
    orders += k.nOrders;
    days += k.nDays;
    if (Number.isFinite(k.turnover)) {
      turn += k.turnover;
      turnN += 1;
    }
  }
  return { stockoutDays, lostVolumeMl: lost, avgHoldingMl: n ? hold / n : 0, avgTurnover: turnN ? turn / turnN : NaN, orders, days };
}

/** Verified Tier 4 backtest totals for any policy over a set of series (used to find the best policy per bar). */
export function policyTotalsFor(ds: Dataset, ids: string[], policy: PolicyId): SimTotals {
  const m = ds.simKpis.get(policy);
  return totalsOf(ids.map((id) => m?.get(id)));
}

export interface PortfolioKpis {
  seriesCount: number;
  counts: Record<Status, number>;
  atRiskCount: number;
  onHandMl: number;
  excessMl: number;
  orderNowMl: number;
  ordersNeeded: number;
  staleCount: number;
  avgOnHandMl: number;
  policy: SimTotals;
  baseline: SimTotals;
}

export function computeKpis(rows: InventoryRow[]): PortfolioKpis {
  const counts: Record<Status, number> = { out: 0, risk: 0, low: 0, healthy: 0, over: 0 };
  let onHand = 0;
  let excess = 0;
  let order = 0;
  let ordersNeeded = 0;
  let stale = 0;
  for (const r of rows) {
    counts[r.status] += 1;
    onHand += r.onHand;
    excess += r.excessQty;
    order += r.orderQty;
    if (r.orderQty > 0) ordersNeeded += 1;
    if (r.stale) stale += 1;
  }
  return {
    seriesCount: rows.length,
    counts,
    atRiskCount: counts.out + counts.risk,
    onHandMl: onHand,
    excessMl: excess,
    orderNowMl: order,
    ordersNeeded,
    staleCount: stale,
    avgOnHandMl: rows.length ? onHand / rows.length : 0,
    policy: totalsOf(rows.map((r) => r.sim)),
    baseline: totalsOf(rows.map((r) => r.baselineSim)),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Recommendations feed
// ---------------------------------------------------------------------------------------------------------------
export type RecKind = "stockout" | "reorder" | "watch" | "overstock";
export type RecSeverity = "critical" | "high" | "medium" | "opportunity";

export interface Recommendation {
  id: string;
  kind: RecKind;
  severity: RecSeverity;
  row: InventoryRow;
  title: string;
  summary: string;
  facts: Array<{ label: string; value: string }>;
  /** Volume this action orders (positive) or frees (overstock). */
  volumeMl: number;
}

const KIND_ORDER: Record<RecKind, number> = { stockout: 0, reorder: 1, watch: 2, overstock: 3 };
const ABC_WEIGHT: Record<AbcClass, number> = { A: 3, B: 2, C: 1 };

export function buildRecommendations(rows: InventoryRow[], opts: { leadTime?: number } = {}): Recommendation[] {
  const L = opts.leadTime ?? DEFAULT_LEAD_TIME;
  const out: Recommendation[] = [];

  for (const r of rows) {
    const where = `${r.brand} at ${shortBar(r.bar)}`;
    const staleNote = r.stale && r.readingAgeDays !== null ? ` The last count is ${r.readingAgeDays} days old, so confirm it before ordering.` : "";
    const cover = fmtDays(r.daysCover);

    if (r.status === "out") {
      out.push({
        id: `${r.id}:stockout`,
        kind: "stockout",
        severity: "critical",
        row: r,
        title: `Order ${fmtVolume(r.orderQty)} of ${where} now`,
        summary: `${r.bar} has none left. The policy expects ${fmtVolume(r.forecastPerDay)} of demand a day, so each day without stock is lost sales.${staleNote}`,
        facts: [
          { label: "On hand", value: fmtVolume(r.onHand) },
          { label: "Order", value: fmtVolume(r.orderQty) },
          { label: "Par level", value: fmtVolume(r.par) },
          { label: "Demand a day", value: fmtVolume(r.forecastPerDay) },
        ],
        volumeMl: r.orderQty,
      });
    } else if (r.status === "risk") {
      out.push({
        id: `${r.id}:reorder`,
        kind: "reorder",
        severity: "high",
        row: r,
        title: `Reorder ${fmtVolume(r.orderQty)} of ${where}`,
        summary: `On hand ${fmtVolume(r.onHand)} is under the ${fmtVolume(r.reorderPoint)} reorder point, which leaves about ${cover} of cover against a ${L}-day delivery.${staleNote}`,
        facts: [
          { label: "On hand", value: fmtVolume(r.onHand) },
          { label: "Reorder point", value: fmtVolume(r.reorderPoint) },
          { label: "Order to par", value: fmtVolume(r.orderQty) },
          { label: "Cover", value: cover },
        ],
        volumeMl: r.orderQty,
      });
    } else if (r.status === "low") {
      const d = r.daysToReorder;
      out.push({
        id: `${r.id}:watch`,
        kind: "watch",
        severity: "medium",
        row: r,
        title: `${where} reaches its reorder point in about ${d === null ? "n/a" : d < 1 ? "a day" : `${Math.round(d)} days`}`,
        summary: `${fmtVolume(r.onHand)} on hand is within twice the ${fmtVolume(r.reorderPoint)} reorder point. Schedule the order with the next delivery.${staleNote}`,
        facts: [
          { label: "On hand", value: fmtVolume(r.onHand) },
          { label: "Reorder point", value: fmtVolume(r.reorderPoint) },
          { label: "Cover", value: cover },
        ],
        volumeMl: 0,
      });
    } else if (r.status === "over") {
      const noDemand = r.forecastPerDay <= 0;
      out.push({
        id: `${r.id}:overstock`,
        kind: "overstock",
        severity: "opportunity",
        row: r,
        title: noDemand ? `${where} has stock but no forecast demand` : `Pause reordering ${where}`,
        summary: noDemand
          ? `${fmtVolume(r.onHand)} is on hand and the policy forecasts no demand. Check whether this item is still on the menu.`
          : `${fmtVolume(r.onHand)} on hand is ${(r.onHand / r.par).toFixed(1)} times the ${fmtVolume(r.par)} par level. That is about ${cover} of cover; the next order is roughly ${fmtDays(r.daysToReorder)} away.`,
        facts: noDemand
          ? [
              { label: "On hand", value: fmtVolume(r.onHand) },
              { label: "Forecast", value: "None" },
            ]
          : [
              { label: "On hand", value: fmtVolume(r.onHand) },
              { label: "Above par", value: fmtVolume(r.excessQty) },
              { label: "Cover", value: cover },
              { label: "Next order in", value: fmtDays(r.daysToReorder) },
            ],
        volumeMl: r.excessQty,
      });
    }
  }

  return out.sort((a, b) => {
    const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (k !== 0) return k;
    if (a.kind === "stockout" || a.kind === "reorder") {
      const w = ABC_WEIGHT[b.row.abc] - ABC_WEIGHT[a.row.abc];
      if (w !== 0) return w;
      return b.row.forecastPerDay - a.row.forecastPerDay;
    }
    if (a.kind === "watch") return (a.row.daysToReorder ?? Infinity) - (b.row.daysToReorder ?? Infinity);
    return b.volumeMl - a.volumeMl;
  });
}
