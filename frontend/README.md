# ParLine: Tier 5 frontend

The bar-manager product on top of the Tier 0 to 4 pipeline. Next.js (App Router), TypeScript, Tailwind, shadcn/ui components, Framer Motion, Recharts.
It only **reads** the CSVs in `../data/processed`; no forecasting, par-level or simulation logic in the pipeline was changed.

## Run

```bash
cd frontend
npm install
npm run dev          # copies the CSVs into public/data first (predev hook), then serves http://localhost:3000
npm run test:parity  # proves the UI's data layer reproduces the verified Tier 4 numbers (no browser needed)
npm run typecheck
```

Placed at `bar_inventory_project/frontend/`, `npm run sync-data` copies 13 CSVs from `../data/processed` to `public/data`. A copy is already included so the app also runs standalone.

## Screens

| Route | What it does |
|---|---|
| `/` | Dashboard: policy verdict, KPI strip with animated counters, demand trend with forecast overlay, top stockout risks, top recommendations |
| `/inventory` | Filterable, sortable table (All, Low stock, Overstocked, At risk, Out of stock). Filter is kept in the URL (`?status=risk`) |
| `/items/[id]` | Bar x brand drill-down: recommendation, demand history with forecast overlay, how par is built, Tier 3 service-level grid, item backtest |
| `/simulation` | Animated day-by-day replay (scrubber, play/pause, 1x/2x/4x) for one item or all items, event log, policy table, lead-time table |
| `/recommendations` | Prioritised action feed with "mark as done" (saved in the browser only) |

Header controls apply everywhere: **bar** and **ordering policy** (default Global ML at 99%, the Tier 4 winner).

## Where every number comes from

- Par, reorder point, safety stock, forecast: `tier4_series_model_inputs.csv` with the same formulae as `tier4_simulation.py`. For the moving-average policy this equals `tier3_par_level_full_grid.csv` (tested). The Tier 3 grid itself feeds the item-level service-level table.
- Backtest KPIs: `tier4_perseries_*.csv`, `tier4_policy_comparison.csv`, `tier4_leadtime_sensitivity.csv`.
- On hand: the latest observed `closing_balance_ml` per series in `daily_bar_consumption.csv`.
- Replay: see below.

## Decisions and assumptions to know about

1. **Replay is computed, then verified.** `tier4_perseries_*.csv` hold one summary row per series, not daily traces. `src/lib/engine/simulate.ts` is a line-for-line port of `simulate_series` that also records the daily trace. `tests/parity.test.ts` checks it against every per-series CSV (5 policies x 96 series), the policy comparison (263 vs 584 stockout days) and the lead-time table (263, 182, 128). The Simulation page shows a live "Matches Tier 4 results" badge.
2. **"Current stock" is the last ledger reading**, dated per item; counts older than 7 days are flagged. There is no purchase-order feed, so order quantities assume nothing is in transit.
3. **No prices in the data.** The "inventory value" KPI shows litres. Enter an assumed price per litre on the card to see value (currency constant `CURRENCY` in `src/lib/config.ts`).
4. **Forecast error is shown as WAPE (1.663), not "accuracy %".** WAPE above 1 is expected on ~81% zero-demand data, so 1 minus WAPE would be negative.
5. **Status thresholds are UI rules, not pipeline outputs** (`src/lib/config.ts`): At risk = below reorder point; Low = under 2x reorder point; Overstocked = 4x par or more (selectable 3x/4x/6x).
6. **Forecast is a run-rate.** The pipeline has no forward forecast, so "forecast a day" is the policy's mean daily forecast over the backtest window.
7. Ledger balances are about 6x par, so many items read as overstocked. Treat that as a prompt to verify counts, not proof of waste.

## Not done here (Tier 6)

No API route, database, auth, or live POS/PO feed. "Mark as done" and preferences use `localStorage`.
