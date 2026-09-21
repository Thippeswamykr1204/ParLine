"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";
import { useApp } from "@/components/providers/app-provider";
import { AnimatedNumber } from "@/components/shared/animated-number";
import { Skeleton } from "@/components/ui/skeleton";
import { BASELINE_POLICY } from "@/lib/config";
import { policyTotalsFor } from "@/lib/engine/inventory";
import { POLICIES, POLICY_IDS } from "@/lib/engine/policy";
import { fmt1, fmtInt } from "@/lib/format";
import type { PolicyId } from "@/lib/types";

const EASE = [0.16, 1, 0.3, 1] as const;

function CompareBar({ label, base, value, format, fmtBase }: { label: string; base: number; value: number; format: (n: number) => string; fmtBase: (n: number) => string }) {
  const pct = base > 0 ? Math.max(Math.min((value / base) * 100, 100), 1.5) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-white/75">{label}</span>
        <span className="text-white/60 tabular-nums">Naive {fmtBase(base)}</span>
      </div>
      <div className="mt-1.5 h-9 rounded-md bg-white/10">
        <motion.div
          className="flex h-full items-center rounded-md bg-accent pl-3 font-display text-lg font-semibold text-accent-foreground"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1, ease: EASE, delay: 0.2 }}
          style={{ minWidth: 92 }}
        >
          <AnimatedNumber value={value} format={format} />
        </motion.div>
      </div>
    </div>
  );
}

export function PolicyVerdict() {
  const { ds, kpis, policy, rows } = useApp();

  const best = useMemo<PolicyId | null>(() => {
    if (!ds) return null;
    const ids = rows.map((r) => r.id);
    let bestId: PolicyId | null = null;
    let bestDays = Infinity;
    for (const p of POLICY_IDS) {
      const d = policyTotalsFor(ds, ids, p).stockoutDays;
      if (d < bestDays) {
        bestDays = d;
        bestId = p;
      }
    }
    return bestId;
  }, [ds, rows]);

  if (!ds || !kpis || !best) return <Skeleton className="h-[21rem] w-full rounded-panel" />;

  const top = ds.modelComparison[0];
  const topFour = ds.modelComparison.slice(0, 4);
  const spreadPct = topFour.length > 1 ? ((topFour[topFour.length - 1].wape - topFour[0].wape) / topFour[0].wape) * 100 : 0;
  const p = kpis.policy;
  const b = kpis.baseline;
  const stockoutCut = b.stockoutDays > 0 ? (1 - p.stockoutDays / b.stockoutDays) * 100 : 0;
  const holdDelta = b.avgHoldingMl > 0 ? (p.avgHoldingMl / b.avgHoldingMl - 1) * 100 : 0;
  const windowDays = ds.validationDates.length;
  const accuracyWonToo = POLICIES[best].model === "rolling_mean_7";
  const isBest = best === policy;

  return (
    <section aria-labelledby="verdict-title" className="grid overflow-hidden rounded-panel bg-primary text-primary-foreground shadow-lift lg:grid-cols-[1.05fr_1fr]">
      <div className="p-6 sm:p-8">
        <h2 id="verdict-title" className="max-w-md text-[28px] font-semibold leading-[1.15] sm:text-[34px]">
          {accuracyWonToo ? "For this selection, the most accurate forecast also made the best policy." : "Forecast accuracy did not choose the best policy. The simulation did."}
        </h2>
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-white/75">
          The 7-day rolling mean has the lowest forecast error (WAPE {top.wape.toFixed(3)}), but the four leading models sit within {spreadPct.toFixed(1)}% of each other. Replaying {windowDays} days of real demand
          through each ordering policy showed which one actually kept bottles on the shelf.
        </p>
        <ul className="mt-5 grid max-w-md grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2" aria-label="Forecast error by model">
          {ds.modelComparison.map((m, i) => (
            <li key={m.model} className="flex items-center justify-between gap-3 border-b border-white/10 py-1">
              <span className="flex items-center gap-2 text-white/80">
                <span className={i === 0 ? "h-2 w-2 rounded-full bg-accent" : "h-2 w-2 rounded-full bg-white/25"} aria-hidden="true" />
                {m.model}
              </span>
              <span className="tabular-nums text-white/90">{m.wape.toFixed(3)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-white/[0.06] p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground">{POLICIES[policy].short}</span>
          <span className="text-white/65">versus {POLICIES[BASELINE_POLICY].short.toLowerCase()}</span>
          <span className="ml-auto text-xs text-white/65">{isBest ? "Best of 5 simulated policies" : `Best simulated: ${POLICIES[best].short}`}</span>
        </div>
        <div className="mt-5 space-y-5">
          <CompareBar label="Stockout days" base={b.stockoutDays} value={p.stockoutDays} format={fmtInt} fmtBase={fmtInt} />
          <CompareBar label="Lost volume" base={b.lostVolumeMl / 1000} value={p.lostVolumeMl / 1000} format={(n) => `${fmt1(n)} L`} fmtBase={(n) => `${fmt1(n)} L`} />
        </div>
        <p className="mt-5 text-sm leading-relaxed text-white/75">
          {stockoutCut >= 0 ? "Stockout days fall" : "Stockout days rise"} {Math.abs(stockoutCut).toFixed(0)}%. The safety buffer costs stock: average holding {holdDelta >= 0 ? "rises" : "falls"} {Math.abs(holdDelta).toFixed(0)}%, from{" "}
          {fmtInt(b.avgHoldingMl)} to {fmtInt(p.avgHoldingMl)} ml per item.
        </p>
      </div>
    </section>
  );
}
