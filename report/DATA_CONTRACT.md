# Data Contract — Tier 0

## What "demand" means here
- `Consumed (ml)` in the raw log = liquid poured/sold, summed per transaction.
- Daily demand = sum of `Consumed (ml)` for a (Date, Bar, Brand) across all transactions that day.
- A day with no transaction rows for a (Bar, Brand) pair is treated as **demand = 0**, not missing. This is an assumption (see below), not an observed fact.

## What is NOT observable in this dataset
- **No lost-sale / backorder field.** If a guest wanted a drink and the bottle was empty, that event is not logged anywhere. The raw data only records what WAS poured, never what was refused.
- **No point-of-sale timestamp separate from the ledger timestamp.** `Date Time Served` is the only time signal; we cannot distinguish "order placed" from "bottle logged."
- **No price, guest count, or event/promo flag.** Demand spikes (e.g. a private event) cannot be explained by any column in this data.
- **No supplier delivery record.** `Purchase (ml)` tells us stock arrived, but not lead time, supplier, or order date — lead time must be an external assumption in later tiers.

## "Inventory depleted" vs. "confirmed stockout" — an important distinction
- **Inventory depleted**: `Closing Balance (ml) == 0` for a (Bar, Brand, Day). This IS observable directly from the data.
- **Confirmed stockout** (a guest wanted the item and could not get it): NOT observable. We cannot tell whether `Closing Balance == 0` because:
  - the bar ran out mid-service and turned away orders (a true stockout), OR
  - the bar simply sold its last unit right as it closed with no unmet demand behind it, OR
  - nobody ordered that brand that day and the balance coincidentally hit zero from a prior draw-down.
- **Consequence for later tiers**: any "stockout count" computed from this data is really a proxy — a *depleted-inventory event* — not a true stockout count. This must be stated explicitly in the managerial write-up and not overclaimed. Tier 3 (simulation) will use *simulated* stockouts against a policy, which are legitimate because they come from a controlled backtest, not from mislabeling this raw signal.

## Zero-fill assumption
- Sparsity analysis (Tier 0, section 3 of `tier0_validation_report.md`) shows **~81% implicit zero-demand slots** across the full Bar x Brand x Date grid.
- Every bar sells every brand at least once across the year (no structural bar-brand coverage gaps), so the zero-fill is a genuine reflection of intermittent demand, not a data-collection artifact.
- Implication for Tier 2 (forecasting): this is intermittent/sparse demand data. WAPE, not MAPE, must be the primary metric (MAPE divides by zero on zero-demand days). Tree-based or Croston-style methods may outperform plain exponential smoothing.

## Grain of the processed dataset
- One row = one (Date, Bar Name, Brand Name) combination.
- `is_observed_day` = True if at least one raw transaction existed for that slot (False = zero-filled).
- `consumed_ml`, `purchase_ml` = daily sums. `opening_balance_ml`/`closing_balance_ml` = first/last observed reading that day (NaN on zero-filled days — no ledger reading exists, this is intentionally NOT filled to zero, since we don't know the true balance on unobserved days).
