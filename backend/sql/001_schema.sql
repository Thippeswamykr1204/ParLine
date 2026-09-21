-- Tier 6 schema. Idempotent enough to be applied once by app.migrate (tracked in schema_migrations).
CREATE TABLE properties (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  is_assumed BOOLEAN NOT NULL DEFAULT FALSE,  -- the raw data has no property column
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE bars (
  id SERIAL PRIMARY KEY,
  property_id INT NOT NULL REFERENCES properties(id),
  name TEXT NOT NULL,
  UNIQUE (property_id, name)
);
CREATE TABLE brands (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  alcohol_type TEXT
);
CREATE TABLE suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_assumed BOOLEAN NOT NULL DEFAULT TRUE,   -- the raw data has no supplier record
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE lead_times (
  id SERIAL PRIMARY KEY,
  supplier_id INT NOT NULL REFERENCES suppliers(id),
  brand_id INT REFERENCES brands(id),          -- NULL = supplier-wide default
  lead_time_days INT NOT NULL CHECK (lead_time_days > 0),
  source TEXT NOT NULL DEFAULT 'assumption'    -- Data contract: lead time is an external assumption
);
CREATE UNIQUE INDEX uq_lead_times ON lead_times (supplier_id, COALESCE(brand_id, 0));

CREATE TABLE inventory_transactions (
  id BIGSERIAL PRIMARY KEY,
  bar_id INT NOT NULL REFERENCES bars(id),
  brand_id INT NOT NULL REFERENCES brands(id),
  served_at TIMESTAMP NOT NULL,
  opening_ml DOUBLE PRECISION NOT NULL,
  purchase_ml DOUBLE PRECISION NOT NULL,
  consumed_ml DOUBLE PRECISION NOT NULL,
  closing_ml DOUBLE PRECISION NOT NULL,
  source TEXT NOT NULL DEFAULT 'seed',
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bar_id, brand_id, served_at, opening_ml, purchase_ml, consumed_ml, closing_ml)
);
CREATE INDEX ix_txn_served ON inventory_transactions (served_at);

CREATE TABLE daily_demand (
  bar_id INT NOT NULL REFERENCES bars(id),
  brand_id INT NOT NULL REFERENCES brands(id),
  demand_date DATE NOT NULL,
  consumed_ml DOUBLE PRECISION NOT NULL,
  purchase_ml DOUBLE PRECISION NOT NULL,
  opening_balance_ml DOUBLE PRECISION,          -- NULL on zero-filled days (Data Contract)
  closing_balance_ml DOUBLE PRECISION,
  n_transactions INT NOT NULL,
  is_observed_day BOOLEAN NOT NULL,
  day_of_week SMALLINT NOT NULL,
  is_weekend SMALLINT NOT NULL,
  PRIMARY KEY (bar_id, brand_id, demand_date)
);
CREATE INDEX ix_daily_date ON daily_demand (demand_date);

-- Tier 1 outputs (ABC + series class). Extra table beyond the brief: the forecasting and export code needs it.
CREATE TABLE series_profiles (
  bar_id INT NOT NULL REFERENCES bars(id),
  brand_id INT NOT NULL REFERENCES brands(id),
  abc_class CHAR(1), series_class TEXT,
  consumed_ml DOUBLE PRECISION, pct_of_total DOUBLE PRECISION, cum_pct DOUBLE PRECISION,
  mean_ml DOUBLE PRECISION, std_ml DOUBLE PRECISION, n_days INT, pct_zero_days DOUBLE PRECISION, cv DOUBLE PRECISION,
  active_mean_ml DOUBLE PRECISION, active_std_ml DOUBLE PRECISION, n_active_days INT, active_cv DOUBLE PRECISION,
  weekday_mean DOUBLE PRECISION, weekend_mean DOUBLE PRECISION, weekend_uplift DOUBLE PRECISION,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bar_id, brand_id)
);

CREATE TABLE forecast_runs (
  id BIGSERIAL PRIMARY KEY,
  run_type TEXT NOT NULL CHECK (run_type IN ('seed','daily','manual')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  data_max_date DATE,
  split_date DATE,
  n_series INT,
  models JSONB,
  validation_report JSONB,
  notes TEXT
);
CREATE INDEX ix_runs_status ON forecast_runs (status, finished_at DESC);

CREATE TABLE forecasts (
  run_id BIGINT NOT NULL REFERENCES forecast_runs(id) ON DELETE CASCADE,
  bar_id INT NOT NULL REFERENCES bars(id),
  brand_id INT NOT NULL REFERENCES brands(id),
  forecast_date DATE NOT NULL,
  model_key TEXT NOT NULL,
  predicted_ml DOUBLE PRECISION NOT NULL,
  actual_ml DOUBLE PRECISION,
  PRIMARY KEY (run_id, bar_id, brand_id, forecast_date, model_key)
);

CREATE TABLE par_levels (
  run_id BIGINT NOT NULL REFERENCES forecast_runs(id) ON DELETE CASCADE,
  bar_id INT NOT NULL REFERENCES bars(id),
  brand_id INT NOT NULL REFERENCES brands(id),
  model_key TEXT NOT NULL,            -- rolling_mean_7 = Tier 3 grid; global_ml = production policy inputs
  lead_time_days INT NOT NULL,
  service_level TEXT NOT NULL,
  z_score DOUBLE PRECISION NOT NULL,
  avg_forecast_demand_per_day_ml DOUBLE PRECISION NOT NULL,
  forecast_rmse_ml DOUBLE PRECISION NOT NULL,
  lead_time_demand_ml DOUBLE PRECISION NOT NULL,
  safety_stock_ml DOUBLE PRECISION NOT NULL,
  par_level_ml DOUBLE PRECISION NOT NULL,
  reorder_point_ml DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (run_id, bar_id, brand_id, model_key, lead_time_days, service_level)
);

-- Tier 4 per-series simulation results (extra table beyond the brief; feeds policy comparison + exports)
CREATE TABLE simulation_results (
  run_id BIGINT NOT NULL REFERENCES forecast_runs(id) ON DELETE CASCADE,
  policy TEXT NOT NULL,
  lead_time_days INT NOT NULL,
  bar_id INT NOT NULL REFERENCES bars(id),
  brand_id INT NOT NULL REFERENCES brands(id),
  stockout_days INT, stockout_rate_pct DOUBLE PRECISION, lost_volume_ml DOUBLE PRECISION,
  avg_holding_ml DOUBLE PRECISION, turnover_ratio DOUBLE PRECISION,
  n_orders_placed INT, n_days_simulated INT,
  PRIMARY KEY (run_id, policy, lead_time_days, bar_id, brand_id)
);

CREATE TABLE reorder_recommendations (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES forecast_runs(id) ON DELETE CASCADE,
  bar_id INT NOT NULL REFERENCES bars(id),
  brand_id INT NOT NULL REFERENCES brands(id),
  kind TEXT NOT NULL CHECK (kind IN ('stockout','reorder','watch','overstock')),
  severity TEXT NOT NULL,
  stock_status TEXT NOT NULL,
  policy TEXT NOT NULL,
  lead_time_days INT NOT NULL,
  on_hand_ml DOUBLE PRECISION NOT NULL,
  reading_date DATE,
  reading_age_days INT,
  is_stale BOOLEAN NOT NULL DEFAULT FALSE,
  forecast_per_day_ml DOUBLE PRECISION,
  par_level_ml DOUBLE PRECISION,
  reorder_point_ml DOUBLE PRECISION,
  recommended_order_ml DOUBLE PRECISION NOT NULL DEFAULT 0,
  excess_ml DOUBLE PRECISION NOT NULL DEFAULT 0,
  days_cover DOUBLE PRECISION,
  days_to_reorder DOUBLE PRECISION,
  rationale TEXT,
  acceptance_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (acceptance_status IN ('pending','accepted','rejected','superseded')),
  decided_at TIMESTAMPTZ,
  decided_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, bar_id, brand_id)
);
CREATE INDEX ix_rec_status ON reorder_recommendations (acceptance_status, severity);

CREATE TABLE purchase_orders (
  id BIGSERIAL PRIMARY KEY,
  recommendation_id BIGINT REFERENCES reorder_recommendations(id),
  supplier_id INT NOT NULL REFERENCES suppliers(id),
  bar_id INT NOT NULL REFERENCES bars(id),
  brand_id INT NOT NULL REFERENCES brands(id),
  quantity_ml DOUBLE PRECISION NOT NULL CHECK (quantity_ml > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','received','cancelled')),
  expected_delivery_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);

CREATE TABLE model_metrics (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES forecast_runs(id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metric_name TEXT NOT NULL,
  model_key TEXT,
  scope TEXT NOT NULL DEFAULT 'overall',
  scope_value TEXT,
  value DOUBLE PRECISION,             -- NULL = placeholder / not yet measurable
  details JSONB
);
CREATE INDEX ix_metrics_name ON model_metrics (metric_name, model_key, recorded_at DESC);
