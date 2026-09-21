"use client";

import { useState, type ReactNode } from "react";
import { useApp } from "@/components/providers/app-provider";
import { AnimatedNumber } from "@/components/shared/animated-number";
import { InfoTip } from "@/components/shared/info-tip";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CURRENCY } from "@/lib/config";
import { fmt1, fmtInt, fmtVolume } from "@/lib/format";
import { cn } from "@/lib/utils";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: CURRENCY, maximumFractionDigits: 0 });

function Cell({ label, tip, children, className }: { label: string; tip: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1 bg-card p-5", className)}>
      <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        {label}
        <InfoTip label={`About ${label}`}>{tip}</InfoTip>
      </div>
      {children}
    </div>
  );
}

const Big = ({ children }: { children: ReactNode }) => <div className="font-display text-[34px] font-semibold leading-none tracking-tight">{children}</div>;
const Sub = ({ children }: { children: ReactNode }) => <p className="text-[13px] leading-snug text-muted-foreground">{children}</p>;

export function KpiStrip() {
  const { ds, kpis, pricePerLitre, setPricePerLitre } = useApp();
  const [editing, setEditing] = useState(false);

  if (!ds || !kpis) return <Skeleton className="h-36 w-full rounded-panel" />;

  const best = ds.modelComparison[0];
  const zeroPct = ds.series.reduce((a, s) => a + (Number.isFinite(s.pctZeroDays) ? s.pctZeroDays : 0), 0) / ds.series.length * 100;
  const litres = kpis.onHandMl / 1000;
  const hasPrice = pricePerLitre !== null;

  return (
    <section aria-label="Key figures" className="grid gap-px overflow-hidden rounded-panel border bg-border shadow-panel sm:grid-cols-2 lg:grid-cols-4">
      <Cell label="Stockout risk" tip="Items with nothing on hand, or below the reorder point under the selected policy. The reorder point is the level at which the simulator would already have placed an order.">
        <Big>
          <AnimatedNumber value={kpis.atRiskCount} />
          <span className="ml-2 text-base font-normal text-muted-foreground">of {kpis.seriesCount} items</span>
        </Big>
        <Sub>
          {kpis.counts.out} out of stock, {kpis.counts.risk} below reorder point. Ordering them to par takes {fmtVolume(kpis.orderNowMl)}.
        </Sub>
      </Cell>

      <Cell label={hasPrice ? "Inventory value" : "Inventory on hand"} tip="Latest ledger closing balance summed across items. The dataset has no prices, so value appears only if you enter an assumed price per litre.">
        <Big>
          {hasPrice ? (
            <AnimatedNumber value={litres * (pricePerLitre as number)} format={(n) => money.format(n)} />
          ) : (
            <>
              <AnimatedNumber value={litres} format={fmt1} />
              <span className="ml-1.5 text-base font-normal text-muted-foreground">L</span>
            </>
          )}
        </Big>
        <Sub>
          {fmtVolume(kpis.excessMl)} sits above par levels.{" "}
          {editing ? (
            <span className="mt-1 flex items-center gap-2">
              <Input
                autoFocus
                inputMode="decimal"
                aria-label={`Assumed price per litre in ${CURRENCY}`}
                placeholder={`Price per litre (${CURRENCY})`}
                defaultValue={pricePerLitre ?? ""}
                className="h-8 w-44"
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setEditing(false);
                }}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  setPricePerLitre(Number.isFinite(v) && v > 0 ? v : null);
                  setEditing(false);
                }}
              />
            </span>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="font-medium text-primary underline underline-offset-2">
              {hasPrice ? `Assumed ${money.format(pricePerLitre as number)} per litre` : "Add a price per litre to see value"}
            </button>
          )}
        </Sub>
      </Cell>

      <Cell label="Forecast error (WAPE)" tip="Weighted absolute percentage error of the best model on the backtest. Lower is better. Values above 1 are normal for intermittent demand where most days sell nothing, which is why the simulation, not this number, picks the policy.">
        <Big>
          <AnimatedNumber value={best.wape} format={(n) => n.toFixed(3)} />
        </Big>
        <Sub>
          Best of {ds.modelComparison.length} models ({best.model}). About {fmtInt(zeroPct)}% of item-days have no demand, so error above 1 is expected.
        </Sub>
      </Cell>

      <Cell label="Average inventory" tip="Average stock held per item across the backtest under the selected policy, compared with the average ledger balance per item at the end of the data.">
        <Big>
          <AnimatedNumber value={kpis.policy.avgHoldingMl} />
          <span className="ml-1.5 text-base font-normal text-muted-foreground">ml per item</span>
        </Big>
        <Sub>
          Policy average in the backtest. Bars hold {fmtVolume(kpis.avgOnHandMl)} per item in the latest ledger.
        </Sub>
      </Cell>
    </section>
  );
}
