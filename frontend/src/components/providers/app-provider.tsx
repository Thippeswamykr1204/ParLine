"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OVERSTOCK_OPTIONS, RECOMMENDED_POLICY, STATUS_RULES, STORAGE_KEY } from "@/lib/config";
import { loadDataset } from "@/lib/data/sources";
import { activeReader } from "@/lib/data/data-source";
import { SELECTABLE_POLICIES } from "@/lib/engine/policy";
import {
  buildRecommendations,
  buildRows,
  computeKpis,
  scopeRows,
  type InventoryRow,
  type PortfolioKpis,
  type Recommendation,
} from "@/lib/engine/inventory";
import type { Dataset, PolicyId } from "@/lib/types";

type LoadStatus = "loading" | "ready" | "error";

interface Prefs {
  bar: string;
  policy: PolicyId;
  overstock: number;
  pricePerLitre: number | null;
}
const DEFAULT_PREFS: Prefs = { bar: "all", policy: RECOMMENDED_POLICY, overstock: STATUS_RULES.overstockMultiple, pricePerLitre: null };
const DONE_KEY = "parline.done.v1";

interface AppContextValue {
  status: LoadStatus;
  error: string | null;
  retry: () => void;
  ds: Dataset | null;
  bar: string;
  setBar: (b: string) => void;
  policy: PolicyId;
  setPolicy: (p: PolicyId) => void;
  overstock: number;
  setOverstock: (n: number) => void;
  pricePerLitre: number | null;
  setPricePerLitre: (n: number | null) => void;
  /** Every series under the selected policy, regardless of bar filter. */
  allRows: InventoryRow[];
  /** Rows for the selected bar. */
  rows: InventoryRow[];
  kpis: PortfolioKpis | null;
  /** Recommendations for the selected bar. */
  recs: Recommendation[];
  done: ReadonlySet<string>;
  toggleDone: (id: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

let datasetPromise: Promise<Dataset> | null = null;
function getDataset(force = false): Promise<Dataset> {
  if (!datasetPromise || force) {
    datasetPromise = loadDataset(activeReader).catch((e) => {
      datasetPromise = null;
      throw e;
    });
  }
  return datasetPromise;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode / quota): preferences simply do not persist */
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [ds, setDs] = useState<Dataset | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const saved = readJson<Partial<Prefs>>(STORAGE_KEY);
    if (saved) {
      setPrefs({
        bar: typeof saved.bar === "string" ? saved.bar : DEFAULT_PREFS.bar,
        policy: SELECTABLE_POLICIES.includes(saved.policy as PolicyId) ? (saved.policy as PolicyId) : DEFAULT_PREFS.policy,
        overstock: (OVERSTOCK_OPTIONS as readonly number[]).includes(saved.overstock as number) ? (saved.overstock as number) : DEFAULT_PREFS.overstock,
        pricePerLitre: typeof saved.pricePerLitre === "number" && saved.pricePerLitre > 0 ? saved.pricePerLitre : null,
      });
    }
    const d = readJson<string[]>(DONE_KEY);
    if (Array.isArray(d)) setDone(new Set(d.filter((x) => typeof x === "string")));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) writeJson(STORAGE_KEY, prefs);
  }, [prefs, hydrated]);
  useEffect(() => {
    if (hydrated) writeJson(DONE_KEY, [...done]);
  }, [done, hydrated]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);
    getDataset(attempt > 0)
      .then((d) => {
        if (cancelled) return;
        setDs(d);
        setStatus("ready");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Unknown error while loading the pipeline outputs.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const bar = ds && (prefs.bar === "all" || ds.bars.includes(prefs.bar)) ? prefs.bar : "all";

  const allRows = useMemo(() => (ds ? buildRows(ds, { policy: prefs.policy, overstockMultiple: prefs.overstock }) : []), [ds, prefs.policy, prefs.overstock]);
  const rows = useMemo(() => scopeRows(allRows, bar), [allRows, bar]);
  const kpis = useMemo(() => (ds ? computeKpis(rows) : null), [ds, rows]);
  const recs = useMemo(() => buildRecommendations(rows), [rows]);

  const setBar = useCallback((b: string) => setPrefs((p) => ({ ...p, bar: b })), []);
  const setPolicy = useCallback((policy: PolicyId) => setPrefs((p) => ({ ...p, policy })), []);
  const setOverstock = useCallback((overstock: number) => setPrefs((p) => ({ ...p, overstock })), []);
  const setPricePerLitre = useCallback((pricePerLitre: number | null) => setPrefs((p) => ({ ...p, pricePerLitre })), []);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const toggleDone = useCallback(
    (id: string) =>
      setDone((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  const value: AppContextValue = {
    status,
    error,
    retry,
    ds,
    bar,
    setBar,
    policy: prefs.policy,
    setPolicy,
    overstock: prefs.overstock,
    setOverstock,
    pricePerLitre: prefs.pricePerLitre,
    setPricePerLitre,
    allRows,
    rows,
    kpis,
    recs,
    done,
    toggleDone,
  };

  return (
    <AppContext.Provider value={value}>
      <MotionConfig reducedMotion="user">
        <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
      </MotionConfig>
    </AppContext.Provider>
  );
}
