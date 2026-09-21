// Copies the Tier 0-4 CSV outputs the UI reads from ../data/processed into public/data.
// Read-only with respect to the pipeline: nothing in data/processed is modified.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "..", "..", "data", "processed");
const dest = resolve(here, "..", "public", "data");

const FILES = [
  "daily_bar_consumption.csv",
  "series_classification.csv",
  "tier2_model_comparison.csv",
  "tier2_validation_predictions.csv",
  "tier3_par_level_full_grid.csv",
  "tier4_series_model_inputs.csv",
  "tier4_policy_comparison.csv",
  "tier4_leadtime_sensitivity.csv",
  "tier4_perseries_Global_ML_99pct_SL.csv",
  "tier4_perseries_Global_ML_95pct_SL.csv",
  "tier4_perseries_Holt-Winters_95pct_SL.csv",
  "tier4_perseries_Moving_Average_95pct_SL.csv",
  "tier4_perseries_Naive_fixed_qty.csv",
];

if (!existsSync(src)) {
  if (FILES.every((f) => existsSync(join(dest, f)))) {
    console.log("[sync-data] ../data/processed not found; using existing public/data copies.");
    process.exit(0);
  }
  console.error(`[sync-data] Cannot find ${src} and public/data is incomplete.`);
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
let bytes = 0;
for (const f of FILES) {
  const from = join(src, f);
  if (!existsSync(from)) {
    console.error(`[sync-data] Missing expected pipeline output: ${f}`);
    process.exit(1);
  }
  copyFileSync(from, join(dest, f));
  bytes += statSync(from).size;
}
console.log(`[sync-data] Copied ${FILES.length} files (${(bytes / 1e6).toFixed(1)} MB) to public/data`);
