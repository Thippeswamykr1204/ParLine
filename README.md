# ParLine: Hotel Bar Inventory Forecasting & Par-Level System

Forecast bar-level demand, recommend par levels, and prove the policy works by replaying it against real history.
Built for a hotel group that suffers **stockouts of popular brands and overstock of slow movers at the same time**.

**Live demo:** _add your Render URL here_ · **API docs:** _`<api-url>/docs`_

---

## Headline result

Backtest on the last 20% of days, 6 bars × 16 brands = 96 series, lead time 2 days (`data/processed/tier4_policy_comparison.csv`):

| Policy | Stockout days | Stockout rate | Lost volume | Avg holding / series |
|---|---:|---:|---:|---:|
| **Global ML @ 99% service level** | **263** | **3.7%** | **49,380 ml** | 431 ml |
| Moving average @ 95% | 426 | 6.0% | 80,795 ml | 328 ml |
| Holt-Winters @ 95% | 477 | 6.7% | 89,488 ml | 316 ml |
| Global ML @ 95% | 496 | 7.0% | 90,946 ml | 313 ml |
| Naive fixed quantity | 584 | 8.2% | 127,604 ml | 258 ml |

> **Forecast accuracy is not the business metric.** Rolling Mean 7d has the lowest WAPE (1.663), yet Global ML at 99% wins once policies are simulated against stockouts and lost volume. Judge policies by simulation, not WAPE alone. WAPE above 1 is expected because ~81% of bar-brand-days have zero demand.

## What it does

1. **Validates** the raw log (`Closing = Opening + Purchase − Consumed`) and builds a zero-filled daily Date × Bar × Brand grid.
2. **Explores** the data: ABC velocity classes, weekday patterns, depleted-inventory audit.
3. **Forecasts** demand with a temporal split: rolling means, seasonal naive, Holt-Winters and a global gradient-boosted model. Scored with WAPE, MAE and RMSE.
4. **Recommends par levels**: `ROP = L·d̂ + Z·σ·√L`, `Par = ROP + cover`, with safety stock from live forecast error and a selectable service level.
5. **Simulates** each policy day by day (lead time, lost sales, order-up-to) and reports stockouts, lost volume, holding and turnover.
6. **Serves it**: FastAPI + Postgres backend, a Next.js manager app, and a read-only chat assistant powered by Groq.

## Architecture

```
data/raw + data/processed ──► src/data (Tier 0-4 pipeline, unchanged)
                                   │  seed on first boot
                                   ▼
Next.js app  ◄── REST ──►  FastAPI  ◄──►  PostgreSQL
(frontend/)               (backend/)       (13 tables + run history)
     │                        │
     └── chat drawer ───► /api/v1/agent/ask ──► Groq (tool calling, read-only)
```

| Tier | What | Where |
|---|---|---|
| 0 | Load, validate, canonical grid, data contract | `src/data/`, `report/tier0_validation_report.md`, `report/DATA_CONTRACT.md` |
| 1 | EDA: ABC, seasonality, stockout audit | `report/tier1_eda_report.md` |
| 2 | Forecasting and WAPE evaluation | `report/tier2_forecasting_report.md` |
| 3 | Par level and safety stock, service-level grid | `report/tier3_par_level_report.md` |
| 4 | Inventory simulation and policy comparison | `report/tier4_simulation_report.md` |
| 5 | Bar-manager web app | `frontend/` |
| 6 | Production backend: API, Postgres, daily job, monitoring | `backend/` |
| 7 | Explain-only agent (never computes numbers itself) | `backend/app/agent/`, `report/tier7_agent_qa_examples.md` |

## Project structure

```
bar_inventory_project/
├── data/
│   ├── raw/bar_inventory_data.xlsx        # original transaction log
│   ├── processed/                         # pipeline outputs (CSV) used by seed + frontend
│   └── incoming/                          # drop new raw-schema files for the daily job
├── src/data/                              # Tier 0-4 scripts
├── backend/                               # FastAPI, SQL schema, ML service, agent, tests
├── frontend/                              # Next.js (App Router, TypeScript, Tailwind)
├── notebooks/                             # take-home submission notebook (optional)
├── report/                                # per-tier reports and figures
├── docker-compose.yml                     # local: Postgres + API (+ optional scheduler)
├── render.yaml                            # Render Blueprint (see DEPLOY.md)
├── DEPLOY.md
├── requirements.txt
└── README.md
```

## Quick start (Docker)

Requires Docker. From the project root:

```bash
cp .env.example .env            # then set GROQ_API_KEY (optional) and change the placeholder secrets
docker compose up --build       # Postgres + API; first boot migrates and seeds from data/
```

* API docs: http://localhost:8000/docs · health: http://localhost:8000/api/v1/health

Run the web app against the API:

```bash
cd frontend
echo "NEXT_PUBLIC_DATA_SOURCE=api"                    >  .env.local
echo "NEXT_PUBLIC_API_BASE_URL=http://localhost:8000" >> .env.local
npm install
npm run dev                     # http://localhost:3000
```

Without those two variables the app runs in **static mode**, reading the bundled CSVs, with no backend needed (the chat assistant needs the backend).

Optional daily scheduler: `docker compose --profile scheduler up --build`.

### Reproduce the pipeline only (no Docker)

```bash
pip install -r requirements.txt
python src/data/tier0_pipeline.py      # validation + canonical grid
```

## Configuration

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection (`postgres://` and `postgresql://` are accepted) | local compose DB |
| `API_KEY` | Required as `X-API-Key` for POST and heavy ML endpoints; empty disables auth (dev only) | empty |
| `CORS_ORIGINS` | Comma-separated allowed web origins, no trailing slash | `http://localhost:3000` |
| `SEED_ON_START` | Seed the database on first boot | `true` |
| `GROQ_API_KEY` | Enables the chat assistant. Free key: https://console.groq.com/keys | empty (assistant disabled) |
| `AGENT_MODEL` | Force a Groq model; blank tries `openai/gpt-oss-120b` then falls back | blank |
| `SCHEDULE_UTC` | Daily job time | `02:00` |
| `NEXT_PUBLIC_DATA_SOURCE` | Frontend: `api` or `static` | `static` |
| `NEXT_PUBLIC_API_BASE_URL` | Frontend: API origin (baked in at build time) | `http://localhost:8000` |

Never commit `.env`. Only `.env.example` is tracked.

## API overview (`/api/v1`)

* Reads: `/bars`, `/brands`, `/inventory`, `/forecasts`, `/par-levels`, `/recommendations`, `/purchase-orders`, `/analytics/*`, `/export/{file}.csv`, `/health`
* Actions: `POST /recommendations/{id}/accept|reject`, `POST /pipeline/run` (key required)
* ML: `POST /ml/forecast`, `/ml/par-level`, `/ml/simulate`, `GET /ml/model-metrics` (key required for the heavy ones)
* Assistant: `POST /agent/ask` (read-only, grounded in tool calls; returns a clear message if no Groq key is set)

Full detail in [`backend/README.md`](backend/README.md) and the interactive `/docs` page.

## The assistant

Ask things like *"Why is Grey Goose high-risk at Johnson's Bar?"* or *"Which policy actually won the simulation, and why?"*
The agent may only call read-only tools that wrap the same queries the REST endpoints use. Every figure in an answer comes from a tool result; it never forecasts, sizes par or writes to the database. If the data isn't there, it says so.

## Tests

```bash
python -m pytest backend/tests -q     # offline, no database needed
cd frontend && npm run test:parity    # UI engine reproduces the verified Tier 4 numbers
cd frontend && npm run typecheck
```

## Deployment

Render Blueprint included (`render.yaml`): free Postgres, Docker API and Next.js web service.
Step-by-step instructions and free-tier caveats are in [`DEPLOY.md`](DEPLOY.md).

## Assumptions and limitations

* **No supplier, lead-time, price or shelf-life data exists** in the source. The system assumes one supplier and a **2-day lead time** (flagged as assumed in the database); lead-time sensitivity is included.
* Unmet demand is **lost**, not back-ordered. A day with no record is treated as zero consumption.
* **Demand is censored:** many zero-consumption records occurred while the item was already empty, so observed demand understates true demand.
* Balances are in **ml**; no bottle sizes.
* Ledger balances are far above par for many items, so the UI shows many as overstocked. Treat that as a prompt to verify counts, not proof of waste.
* The pipeline has no forward-looking forecast table; "forecast per day" is the policy's mean daily forecast over the backtest window.
* Free-tier hosting sleeps when idle and the free database has a limited lifetime.

## Author

Thippeswamy · [github.com/thippeswamykr1204](https://github.com/thippeswamykr1204)