import { num, parseCsv, type CsvRow } from "../csv";
import { seriesId } from "../format";
import { POLICIES, POLICY_IDS, policyByCsvName } from "../engine/policy";
import type {
  AbcClass,
  Dataset,
  GridRow,
  LeadTimeRow,
  LedgerReading,
  ModelComparisonRow,
  ModelKey,
  PolicyId,
  PolicySummary,
  SeriesInputs,
  SeriesMeta,
  SimSeriesKpi,
  ValidationPoint,
} from "../types";

export type ReadText = (file: string) => Promise<string>;

export const DATA_FILES = {
  daily: "daily_bar_consumption.csv",
  classification: "series_classification.csv",
  modelComparison: "tier2_model_comparison.csv",
  validation: "tier2_validation_predictions.csv",
  grid: "tier3_par_level_full_grid.csv",
  inputs: "tier4_series_model_inputs.csv",
  policyComparison: "tier4_policy_comparison.csv",
  leadTime: "tier4_leadtime_sensitivity.csv",
} as const;

const MODEL_KEYS: ModelKey[] = ["seasonal_naive", "rolling_mean_7", "holt_winters", "global_ml"];

function need(row: CsvRow, col: string, file: string): string {
  const v = row[col];
  if (v === undefined) throw new Error(`${file}: expected column "${col}" was not found. The pipeline output schema has changed.`);
  return v;
}
function needNum(row: CsvRow, col: string, file: string): number {
  return num(need(row, col, file));
}

function summaryFrom(row: CsvRow, file: string): PolicySummary {
  return {
    policy: need(row, "policy", file),
    totalStockoutDays: needNum(row, "total_stockout_days", file),
    stockoutRatePct: needNum(row, "stockout_rate_pct", file),
    totalLostVolumeMl: needNum(row, "total_lost_volume_ml", file),
    avgHoldingMlPerSeries: needNum(row, "avg_holding_ml_per_series", file),
    totalHoldingMl: needNum(row, "total_holding_ml_across_series", file),
    avgTurnover: needNum(row, "avg_turnover_ratio", file),
    totalOrders: needNum(row, "total_orders_placed", file),
  };
}

export async function loadDataset(read: ReadText): Promise<Dataset> {
  const perSeriesFiles = POLICY_IDS.map((id) => POLICIES[id].file);
  const [
    dailyTxt,
    classTxt,
    cmpTxt,
    valTxt,
    gridTxt,
    inputsTxt,
    polTxt,
    ltTxt,
    ...perSeriesTxt
  ] = await Promise.all([
    read(DATA_FILES.daily),
    read(DATA_FILES.classification),
    read(DATA_FILES.modelComparison),
    read(DATA_FILES.validation),
    read(DATA_FILES.grid),
    read(DATA_FILES.inputs),
    read(DATA_FILES.policyComparison),
    read(DATA_FILES.leadTime),
    ...perSeriesFiles.map((f) => read(f)),
  ]);

  // ---- series metadata + model inputs (Tier 4 inputs are canonical for ABC and class) -------------------------
  const classRows = parseCsv(classTxt);
  const classByKey = new Map<string, CsvRow>();
  for (const r of classRows) classByKey.set(seriesId(r["Bar Name"], r["Brand Name"]), r);

  const dailyRows = parseCsv(dailyTxt);
  const alcoholByBrand = new Map<string, string>();
  for (const r of dailyRows) if (!alcoholByBrand.has(r["Brand Name"])) alcoholByBrand.set(r["Brand Name"], r["Alcohol Type"]);

  const inputRows = parseCsv(inputsTxt);
  const series: SeriesMeta[] = [];
  const inputs = new Map<string, SeriesInputs>();
  for (const r of inputRows) {
    const bar = need(r, "Bar Name", DATA_FILES.inputs);
    const brand = need(r, "Brand Name", DATA_FILES.inputs);
    const id = seriesId(bar, brand);
    const cls = classByKey.get(id);
    series.push({
      id,
      bar,
      brand,
      alcoholType: alcoholByBrand.get(brand) ?? "Other",
      abc: need(r, "abc_class", DATA_FILES.inputs) as AbcClass,
      seriesClass: need(r, "series_class", DATA_FILES.inputs),
      pctZeroDays: cls ? num(cls["pct_zero_days"]) : NaN,
      weekendUplift: cls ? num(cls["weekend_uplift"]) : NaN,
    });
    const models = {} as Record<ModelKey, { mean: number; rmse: number }>;
    for (const k of MODEL_KEYS) {
      models[k] = {
        mean: needNum(r, `pred_${k}_mean`, DATA_FILES.inputs),
        rmse: needNum(r, `pred_${k}_rmse`, DATA_FILES.inputs),
      };
    }
    inputs.set(id, { avgActual: needNum(r, "avg_actual_demand_per_day", DATA_FILES.inputs), models });
  }
  series.sort((a, b) => a.bar.localeCompare(b.bar) || a.brand.localeCompare(b.brand));
  const seriesById = new Map(series.map((s) => [s.id, s]));
  const bars = [...new Set(series.map((s) => s.bar))].sort();

  // ---- full-year history + latest ledger reading per series ---------------------------------------------------
  const dateSet = new Set<string>();
  for (const r of dailyRows) dateSet.add(r["Date"]);
  const historyDates = [...dateSet].sort();
  const dateIndex = new Map(historyDates.map((d, i) => [d, i]));
  const history = new Map<string, number[]>();
  const ledger = new Map<string, LedgerReading | null>();
  for (const s of series) {
    history.set(s.id, new Array(historyDates.length).fill(0));
    ledger.set(s.id, null);
  }
  for (const r of dailyRows) {
    const id = seriesId(r["Bar Name"], r["Brand Name"]);
    const arr = history.get(id);
    if (!arr) continue;
    const idx = dateIndex.get(r["Date"]);
    if (idx === undefined) continue;
    arr[idx] = num(r["consumed_ml"]);
    if (r["is_observed_day"] === "True") {
      const closing = num(r["closing_balance_ml"]);
      const prev = ledger.get(id);
      if (Number.isFinite(closing) && (!prev || r["Date"] >= prev.date)) ledger.set(id, { date: r["Date"], closing });
    }
  }
  const asOf = historyDates[historyDates.length - 1];

  // ---- validation-window actuals and model predictions --------------------------------------------------------
  const validation = new Map<string, ValidationPoint[]>();
  const valDateSet = new Set<string>();
  for (const r of parseCsv(valTxt)) {
    const id = seriesId(r["Bar Name"], r["Brand Name"]);
    valDateSet.add(r["Date"]);
    const p: ValidationPoint = {
      date: r["Date"],
      actual: needNum(r, "consumed_ml", DATA_FILES.validation),
      preds: {
        seasonal_naive: needNum(r, "pred_seasonal_naive", DATA_FILES.validation),
        rolling_mean_7: needNum(r, "pred_rolling_mean_7", DATA_FILES.validation),
        holt_winters: needNum(r, "pred_holt_winters", DATA_FILES.validation),
        global_ml: needNum(r, "pred_global_ml", DATA_FILES.validation),
      },
    };
    const list = validation.get(id);
    if (list) list.push(p);
    else validation.set(id, [p]);
  }
  for (const list of validation.values()) list.sort((a, b) => (a.date < b.date ? -1 : 1));
  const validationDates = [...valDateSet].sort();

  // ---- Tier 3 par-level grid ----------------------------------------------------------------------------------
  const grid: GridRow[] = parseCsv(gridTxt).map((r) => ({
    seriesId: seriesId(need(r, "Bar Name", DATA_FILES.grid), need(r, "Brand Name", DATA_FILES.grid)),
    leadTimeDays: needNum(r, "lead_time_days", DATA_FILES.grid),
    serviceLevel: need(r, "service_level", DATA_FILES.grid),
    z: needNum(r, "z_score", DATA_FILES.grid),
    avgForecastPerDay: needNum(r, "avg_forecast_demand_per_day_ml", DATA_FILES.grid),
    rmse: needNum(r, "forecast_rmse_ml", DATA_FILES.grid),
    leadTimeDemand: needNum(r, "lead_time_demand_ml", DATA_FILES.grid),
    safetyStock: needNum(r, "safety_stock_ml", DATA_FILES.grid),
    par: needNum(r, "par_level_ml", DATA_FILES.grid),
    reorderPoint: needNum(r, "reorder_point_ml", DATA_FILES.grid),
  }));
  const gridBySeries = new Map<string, GridRow[]>();
  for (const g of grid) {
    const l = gridBySeries.get(g.seriesId);
    if (l) l.push(g);
    else gridBySeries.set(g.seriesId, [g]);
  }

  // ---- Tier 4 outputs -----------------------------------------------------------------------------------------
  const policySummary = new Map<PolicyId, PolicySummary>();
  for (const r of parseCsv(polTxt)) {
    const id = policyByCsvName(need(r, "policy", DATA_FILES.policyComparison));
    if (id) policySummary.set(id, summaryFrom(r, DATA_FILES.policyComparison));
  }
  const leadTimeSensitivity: LeadTimeRow[] = parseCsv(ltTxt)
    .map((r) => {
      const s = summaryFrom(r, DATA_FILES.leadTime);
      const m = /@ L=(\d+)d/.exec(s.policy);
      return { ...s, leadTimeDays: m ? Number(m[1]) : NaN };
    })
    .sort((a, b) => a.leadTimeDays - b.leadTimeDays);

  const simKpis = new Map<PolicyId, Map<string, SimSeriesKpi>>();
  POLICY_IDS.forEach((pid, i) => {
    const file = POLICIES[pid].file;
    const m = new Map<string, SimSeriesKpi>();
    for (const r of parseCsv(perSeriesTxt[i])) {
      m.set(seriesId(need(r, "Bar Name", file), need(r, "Brand Name", file)), {
        stockoutDays: needNum(r, "stockout_days", file),
        stockoutRatePct: needNum(r, "stockout_rate_pct", file),
        lostVolumeMl: needNum(r, "lost_volume_ml", file),
        avgHoldingMl: needNum(r, "avg_holding_ml", file),
        turnover: needNum(r, "turnover_ratio", file),
        nOrders: needNum(r, "n_orders_placed", file),
        nDays: needNum(r, "n_days_simulated", file),
      });
    }
    simKpis.set(pid, m);
  });

  const modelComparison: ModelComparisonRow[] = parseCsv(cmpTxt)
    .map((r) => ({
      model: need(r, "model", DATA_FILES.modelComparison),
      wape: needNum(r, "WAPE", DATA_FILES.modelComparison),
      mae: needNum(r, "MAE", DATA_FILES.modelComparison),
      rmse: needNum(r, "RMSE", DATA_FILES.modelComparison),
    }))
    .sort((a, b) => a.wape - b.wape);

  if (series.length === 0) throw new Error("tier4_series_model_inputs.csv contained no series.");

  return {
    asOf,
    historyDates,
    validationDates,
    bars,
    series,
    seriesById,
    inputs,
    history,
    ledger,
    validation,
    grid,
    gridBySeries,
    policySummary,
    leadTimeSensitivity,
    simKpis,
    modelComparison,
  };
}

/** Browser reader: static files served from /public/data. */
export const browserReader: ReadText = async (file) => {
  const res = await fetch(`/data/${file}`);
  if (!res.ok) throw new Error(`Could not load ${file} (HTTP ${res.status}). Run "npm run sync-data" to copy the pipeline outputs into public/data.`);
  return res.text();
};
