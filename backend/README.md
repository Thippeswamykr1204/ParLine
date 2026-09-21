# Tier 6 — production backend

```
docker-compose up --build          # Postgres + FastAPI. First boot: migrate + seed from data/raw + data/processed
open http://localhost:8000/docs    # OpenAPI UI
```
Optional daily scheduler container: `docker-compose --profile scheduler up --build` (or use `backend/cron/crontab`).

## Read this first
The forecast-accuracy winner (**Rolling Mean 7d**, WAPE 1.663) is **not** the business winner. Simulated against stockouts and
lost volume, **Global ML at a 99% service level** wins (263 stockout days vs 584 naive, lost volume 127,604 ml -> 49,380 ml).
Every analytics/ML endpoint returns this note; the daily job stores both winners in `model_metrics` (`winner_summary`).

## Layout
| Path | Purpose |
|---|---|
| `sql/001_schema.sql` | Schema: the 13 requested tables + `series_profiles`, `simulation_results` (Tier 1 classes, Tier 4 per-series results) |
| `app/seed.py`, `app/migrate.py`, `app/bootstrap.py` | Migration + CSV/XLSX seed, run on container start |
| `app/legacy.py` | Imports `src/data/tier0-4` **unmodified**; redirects Tier 1's file writes to a temp dir so `data/processed` is never overwritten |
| `app/ml/service.py` | Glue over Tier 2-4 functions (features, split, baselines, HW, HistGBM, WAPE, par formulas, simulation loop) |
| `app/recommendation_engine.py` | Python port of the frontend's status/order/recommendation rules |
| `app/pipeline/daily_job.py` | Daily job (ingest, validate, daily_demand, forecast, par, sims, recs, metrics) |
| `app/monitoring.py` | WAPE/MAE/bias + drift vs previous run, stockout rate, acceptance-rate placeholder -> `model_metrics` |
| `app/exports.py` | Rebuilds the exact static CSVs from the DB (frontend API mode) |
| `app/api/` | FastAPI: `routes.py` (REST), `ml_routes.py` (/ml/*) |

## Endpoints (`/api/v1`)
`GET /bars /bars/{id} /brands /suppliers /inventory /forecasts /forecasts/runs /par-levels /recommendations /purchase-orders`,
`POST /recommendations/{id}/accept|reject` (accept creates a draft purchase order),
`GET /analytics/{policy-comparison,model-comparison,demand-trend,kpis,metrics-history}`,
`POST /ml/forecast`, `POST /ml/par-level`, `POST /ml/simulate`, `GET /ml/model-metrics`,
`POST /pipeline/run`, `GET /export/{file}.csv`, `GET /health`.
`POST` endpoints and the heavy ML ones require `X-API-Key` when `API_KEY` is set.

## Daily job
`python -m app.pipeline.daily_job` — drop raw-schema CSV/XLSX files in `data/incoming/` (moved to `done/` after success).
Rows failing the Tier 0 conservation check or basic validation are rejected; the run aborts if more than `MAX_INVALID_PCT` (5%) are bad.
A run writes under one `forecast_runs` id and only becomes visible when it finishes `success`; a failed run leaves the previous run serving.
Forecasts are the Tier 2 chronological backtest re-run on refreshed data (same semantics as Tier 2 — there is no forward-looking forecast table).

## Frontend API mode
```
# frontend/.env.local
NEXT_PUBLIC_DATA_SOURCE=api
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```
Default is `static` (CSV files, unchanged). API mode fetches `/api/v1/export/<file>.csv`, so the same `loadDataset` + TypeScript engine run on DB data.

## Tests
`python -m pytest backend/tests -q` (offline; no DB): CSV round-trips, Tier 2-4 parity through the service layer, recommendation rules,
Tier 1 no-overwrite guard. `cd frontend && npm run test:parity` is untouched.

## Assumptions
No property, supplier or lead-time data exists in the raw file: seed creates one assumed property, one assumed supplier and a 2-day default lead time (flagged `is_assumed` / `source`).
