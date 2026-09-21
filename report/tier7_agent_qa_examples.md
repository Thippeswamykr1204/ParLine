# Tier 7 — Example Agent Transcripts

These are real transcripts against `POST /api/v1/agent/ask`, included to show the
agent grounding answers in tool output and declining when it has none.

## 1. Grounded — why is an item high-risk

**Q:** Why is Grey Goose high-risk at Johnson's Bar?

**Tool calls:**
```
get_stockout_risk(bar="Johnson's Bar", brand="Grey Goose")
 -> {"found": true, "status": "critical", "on_hand_ml": 900.0,
     "forecast_per_day_ml": 620.4, "days_cover": 1.45,
     "open_recommendation": {"kind": "stockout", "severity": "critical",
       "recommended_order_ml": 4200.0, "days_cover": 1.45, "days_to_reorder": 0}}
```

**A:** Grey Goose at Johnson's Bar is flagged critical because on-hand stock
(900 ml) covers only about 1.5 days at the current forecast pace (~620 ml/day)
— well under the lead time. There's an open stockout recommendation to order
4,200 ml now (days_to_reorder = 0).

## 2. Grounded — par level lookup

**Q:** What's the 99% par level for Grey Goose at Johnson's Bar?

**Tool calls:**
```
get_par_level(bar="Johnson's Bar", brand="Grey Goose", service_level="99%")
 -> {"found": true, "lead_time_days": 2, "service_level": "99%", "z_score": 2.326,
     "avg_forecast_demand_per_day_ml": 620.4, "forecast_rmse_ml": 210.8,
     "lead_time_demand_ml": 1240.8, "safety_stock_ml": 693.1, "par_level_ml": 1933.9,
     "reorder_point_ml": 1933.9}
```

**A:** At 99% service level with a 2-day lead time: lead-time demand is
~1,241 ml, safety stock (z=2.326) adds ~693 ml, for a par level of ~1,934 ml.
Reorder point matches the par level at this policy's settings.

## 3. Grounded — the policy nuance the assignment calls out

**Q:** Which policy actually won, and why isn't it the one with the best forecast?

**Tool calls:**
```
simulate_policy(policy="Global ML (99% SL)")
 -> {"found": true, "policy": "Global ML (99% SL)", "simulation_winner": "Global ML (99% SL)",
     "stockout_days": 263, "lost_volume_ml": 49380, ...}
```

**A:** Global ML at 99% service level won the simulation: 263 stockout days
and 49,380 ml lost volume across the backtest, vs 584 stockout days and
127,604 ml for the naive baseline (a 55% cut). It's *not* the forecast-accuracy
winner though — Rolling Mean (7d) has the lowest WAPE (1.663). Lower error
doesn't automatically mean fewer stockouts once you simulate real
replenishment timing and variance; that's why the system's default policy is
picked by simulation, not by WAPE.

## 4. Correctly declines — data the schema doesn't have

**Q:** Why did we run out of Grey Goose specifically last Tuesday?

**Tool calls:**
```
get_stockout_risk(bar="Johnson's Bar", brand="Grey Goose")
 -> {"found": true, ...}   # no per-incident cause field exists anywhere in the schema
```

**A:** I can see Grey Goose at Johnson's Bar is currently critical (about 1.5
days of cover left), but I don't have a way to explain a specific day's
stockout — the data doesn't record a reason for individual stockout events,
only daily balances and forecasts. That lines up with the Tier 0 finding that
lost demand isn't directly observable in this dataset; I can't guess a cause
without making one up.

## 5. Correctly declines — unknown series

**Q:** What's the par level for Hendrick's Gin at The Rooftop?

**Tool calls:**
```
get_par_level(bar="The Rooftop", brand="Hendrick's Gin", service_level="99%")
 -> {"found": false, "reason": "unknown bar or brand: 'The Rooftop'/\"Hendrick's Gin\""}
```

**A:** I don't have a series for Hendrick's Gin at "The Rooftop" — that bar or
brand name doesn't match anything in the data. Check the bar/brand list on the
dashboard for the exact names.
