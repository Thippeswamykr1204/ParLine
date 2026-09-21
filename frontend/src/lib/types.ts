export type PolicyId = "gml99" | "gml95" | "hw95" | "ma95" | "naive";
export type ModelKey = "seasonal_naive" | "rolling_mean_7" | "holt_winters" | "global_ml";
export type AbcClass = "A" | "B" | "C";
export type Status = "out" | "risk" | "low" | "healthy" | "over";

export interface SeriesMeta {
  id: string;
  bar: string;
  brand: string;
  alcoholType: string;
  abc: AbcClass;
  seriesClass: string;
  pctZeroDays: number;
  weekendUplift: number;
}

export interface ModelStats {
  mean: number;
  rmse: number;
}
export interface SeriesInputs {
  avgActual: number;
  models: Record<ModelKey, ModelStats>;
}

export interface LedgerReading {
  date: string;
  closing: number;
}

export interface ValidationPoint {
  date: string;
  actual: number;
  preds: Record<ModelKey, number>;
}

export interface GridRow {
  seriesId: string;
  leadTimeDays: number;
  serviceLevel: string;
  z: number;
  avgForecastPerDay: number;
  rmse: number;
  leadTimeDemand: number;
  safetyStock: number;
  par: number;
  reorderPoint: number;
}

export interface PolicySummary {
  policy: string;
  totalStockoutDays: number;
  stockoutRatePct: number;
  totalLostVolumeMl: number;
  avgHoldingMlPerSeries: number;
  totalHoldingMl: number;
  avgTurnover: number;
  totalOrders: number;
}

export interface LeadTimeRow extends PolicySummary {
  leadTimeDays: number;
}

export interface SimSeriesKpi {
  stockoutDays: number;
  stockoutRatePct: number;
  lostVolumeMl: number;
  avgHoldingMl: number;
  turnover: number;
  nOrders: number;
  nDays: number;
}

export interface ModelComparisonRow {
  model: string;
  wape: number;
  mae: number;
  rmse: number;
}

export interface Dataset {
  /** Last date present in the ledger. The UI treats this as "today". */
  asOf: string;
  historyDates: string[];
  validationDates: string[];
  bars: string[];
  series: SeriesMeta[];
  seriesById: Map<string, SeriesMeta>;
  inputs: Map<string, SeriesInputs>;
  history: Map<string, number[]>;
  ledger: Map<string, LedgerReading | null>;
  validation: Map<string, ValidationPoint[]>;
  grid: GridRow[];
  gridBySeries: Map<string, GridRow[]>;
  policySummary: Map<PolicyId, PolicySummary>;
  leadTimeSensitivity: LeadTimeRow[];
  simKpis: Map<PolicyId, Map<string, SimSeriesKpi>>;
  modelComparison: ModelComparisonRow[];
}
