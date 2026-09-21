import type { PolicyId } from "./types";

/** The Tier 4 winner. The UI defaults to it because simulation, not forecast WAPE, picked it. */
export const RECOMMENDED_POLICY: PolicyId = "gml99";
/** Baseline every policy is compared against in the UI. */
export const BASELINE_POLICY: PolicyId = "naive";
/** Lead time the Tier 4 policy comparison was simulated at. */
export const DEFAULT_LEAD_TIME = 2;

/** Status thresholds, expressed against the policy's own numbers so they move when the policy changes. */
export const STATUS_RULES = {
  /** on-hand >= this many x par level counts as overstocked (user-adjustable in the UI). */
  overstockMultiple: 4,
  /** on-hand below this many x reorder point (but above it) counts as low. */
  lowMultiple: 2,
  /** ledger reading older than this many days before the data end is flagged stale. */
  staleDays: 7,
} as const;

export const OVERSTOCK_OPTIONS = [3, 4, 6] as const;

/** Display currency for the optional "assumed price per litre" value estimate. The dataset has no prices. */
export const CURRENCY = "INR";

export const STORAGE_KEY = "parline.prefs.v1";
