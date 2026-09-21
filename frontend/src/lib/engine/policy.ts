import type { ModelKey, PolicyId, SeriesInputs } from "../types";

/**
 * The five Tier 4 policies. `csvName` is the exact string used in tier4_policy_comparison.csv and
 * `file` the per-series results file, so the UI can be cross-checked against the verified outputs.
 */
export interface PolicyDef {
  id: PolicyId;
  csvName: string;
  file: string;
  label: string;
  short: string;
  model: ModelKey | null;
  z: number | null;
  kind: "order-up-to" | "fixed";
  blurb: string;
}

export const SERVICE_Z: Record<string, number> = { "90%": 1.282, "95%": 1.645, "99%": 2.326 };

export const POLICIES: Record<PolicyId, PolicyDef> = {
  gml99: {
    id: "gml99",
    csvName: "Global ML (99% SL)",
    file: "tier4_perseries_Global_ML_99pct_SL.csv",
    label: "Global ML at 99% service level",
    short: "Global ML 99%",
    model: "global_ml",
    z: 2.326,
    kind: "order-up-to",
    blurb: "Gradient-boosted global forecast with a 99% safety buffer. Fewest stockouts in the backtest.",
  },
  gml95: {
    id: "gml95",
    csvName: "Global ML (95% SL)",
    file: "tier4_perseries_Global_ML_95pct_SL.csv",
    label: "Global ML at 95% service level",
    short: "Global ML 95%",
    model: "global_ml",
    z: 1.645,
    kind: "order-up-to",
    blurb: "Same forecast, thinner buffer. Holds less stock but stocks out about twice as often.",
  },
  hw95: {
    id: "hw95",
    csvName: "Holt-Winters (95% SL)",
    file: "tier4_perseries_Holt-Winters_95pct_SL.csv",
    label: "Holt-Winters at 95% service level",
    short: "Holt-Winters 95%",
    model: "holt_winters",
    z: 1.645,
    kind: "order-up-to",
    blurb: "Weekly-cycle exponential smoothing with a 95% buffer.",
  },
  ma95: {
    id: "ma95",
    csvName: "Moving Average (95% SL)",
    file: "tier4_perseries_Moving_Average_95pct_SL.csv",
    label: "7-day moving average at 95% service level",
    short: "Moving avg 95%",
    model: "rolling_mean_7",
    z: 1.645,
    kind: "order-up-to",
    blurb: "Best raw forecast error, but not the best policy once simulated. Matches the Tier 3 par grid.",
  },
  naive: {
    id: "naive",
    csvName: "Naive (fixed qty)",
    file: "tier4_perseries_Naive_fixed_qty.csv",
    label: "Naive fixed-quantity reorder",
    short: "Naive fixed qty",
    model: null,
    z: null,
    kind: "fixed",
    blurb: "No forecast and no safety stock: reorder at average demand times lead time, order one week of average demand.",
  },
};

export const POLICY_IDS = Object.keys(POLICIES) as PolicyId[];
/** Policies a manager can choose to run their bar on (the naive rule is only ever the baseline). */
export const SELECTABLE_POLICIES: PolicyId[] = ["gml99", "gml95", "hw95", "ma95"];

export function policyByCsvName(name: string): PolicyId | null {
  for (const id of POLICY_IDS) if (POLICIES[id].csvName === name) return id;
  return null;
}

export interface PolicyParams {
  forecastPerDay: number;
  rmse: number;
  leadTimeDemand: number;
  safetyStock: number;
  par: number;
  reorderPoint: number;
  /** Set only for the naive policy. */
  fixedOrderQty: number | null;
}

/**
 * Same formulae as tier4_simulation.py:
 *   order-up-to:  LTD = forecast x L;  SS = z x RMSE x sqrt(L);  par = ROP = LTD + SS
 *   naive:        ROP = mean actual x L;  fixed order = 7 x mean actual
 * For the naive policy `par` is reported as ROP + fixed order (the level right after a typical order)
 * because it has no order-up-to target; the UI labels it accordingly.
 */
export function policyParams(def: PolicyDef, inputs: SeriesInputs, leadTime: number): PolicyParams {
  if (def.kind === "fixed" || def.model === null || def.z === null) {
    const rop = inputs.avgActual * leadTime;
    const fixed = inputs.avgActual * 7;
    return {
      forecastPerDay: inputs.avgActual,
      rmse: 0,
      leadTimeDemand: rop,
      safetyStock: 0,
      par: rop + fixed,
      reorderPoint: rop,
      fixedOrderQty: fixed,
    };
  }
  const m = inputs.models[def.model];
  const ltd = m.mean * leadTime;
  const ss = def.z * m.rmse * Math.sqrt(leadTime);
  const par = ltd + ss;
  return {
    forecastPerDay: m.mean,
    rmse: m.rmse,
    leadTimeDemand: ltd,
    safetyStock: ss,
    par,
    reorderPoint: par,
    fixedOrderQty: null,
  };
}
