# Hotel Bar Inventory Forecasting — Tier 0

Foundation tier. Data in, data validated, canonical grid out. No models. No UI.

## Setup
```
pip install -r requirements.txt
python src/data/tier0_pipeline.py
```

## What this tier does
1. Loads raw transaction log (`data/raw/bar_inventory_data.xlsx`).
2. Validates `Closing = Opening + Purchase - Consumed` with explicit tolerance (see `report/tier0_validation_report.md`).
3. Quantifies sparsity — real vs. implicit-zero demand slots.
4. Builds the canonical daily Date x Bar x Brand grid, zero-filled (`data/processed/daily_bar_consumption.csv`).
5. Documents the data contract (`report/DATA_CONTRACT.md`) — what demand means, what's not observable, depleted vs. stockout.

## Structure
```
bar_inventory_project/
├── data/
│   ├── raw/bar_inventory_data.xlsx
│   └── processed/daily_bar_consumption.csv
├── src/data/tier0_pipeline.py
├── notebooks/            <- Tier 1+ EDA and modeling goes here
├── report/
│   ├── tier0_validation_report.md
│   └── DATA_CONTRACT.md
├── requirements.txt
└── README.md
```

## Next tiers (not built yet)
- Tier 1: EDA — ABC velocity classification, day-of-week seasonality, depleted-inventory audit.
- Tier 2: Forecasting — baseline, Holt-Winters, tree-based, WAPE evaluation.
- Tier 3: Par level calc + simulation backtest.
- Tier 4: Report + video walkthrough.

## Tier 7 — explain-only agent

`POST /api/v1/agent/ask` (backend/app/agent/) lets a manager ask questions in plain
language. The agent calls read-only tools (`backend/app/agent/tools.py`) that are thin
wrappers over the exact Tier 2-6 query paths the REST endpoints already use — it never
computes a forecast, par level, safety stock or recommendation itself, and cannot write
to the DB. Set `GROQ_API_KEY` in `.env` (free key: https://console.groq.com/keys) to enable it; without it the endpoint returns
a clear "disabled" message instead of failing silently. Frontend entry point: the chat
bubble in `frontend/src/components/shared/agent-drawer.tsx`, mounted once in `AppShell`
so it's available from every page. See `report/tier7_agent_qa_examples.md` for sample
transcripts and `backend/tests/test_agent.py` for the offline test suite (separate file,
does not modify `test_offline.py`).

## Tier 6 — production backend
`docker-compose up --build` starts Postgres + FastAPI (docs at http://localhost:8000/docs). See `backend/README.md`.
