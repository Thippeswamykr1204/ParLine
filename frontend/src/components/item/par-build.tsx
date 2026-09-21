"use client";

import { motion } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { POLICIES } from "@/lib/engine/policy";
import type { InventoryRow } from "@/lib/engine/inventory";
import { fmtVolume } from "@/lib/format";
import type { PolicyId } from "@/lib/types";

export function ParBuild({ row, policy, leadTime }: { row: InventoryRow; policy: PolicyId; leadTime: number }) {
  const def = POLICIES[policy];
  const total = Math.max(row.par, row.onHand, 1);
  const w = (v: number) => `${(v / total) * 100}%`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>How the par level is built</CardTitle>
        <CardDescription>
          {def.kind === "fixed"
            ? "The naive rule has no safety stock: it reorders at average demand over the lead time."
            : `Demand over the ${leadTime}-day delivery, plus a buffer sized to this item's own forecast error.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative mt-2 h-10 w-full overflow-hidden rounded-lg bg-muted">
          <motion.div className="absolute inset-y-0 left-0 bg-primary" initial={{ width: 0 }} animate={{ width: w(row.leadTimeDemand) }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} />
          <motion.div className="absolute inset-y-0 bg-primary/45" initial={{ width: 0 }} animate={{ width: w(row.safetyStock), left: w(row.leadTimeDemand) }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.1 }} />
          <div className="absolute inset-y-0 w-[3px] bg-accent" style={{ left: `calc(${w(row.par)} - 3px)` }} aria-hidden="true" />
        </div>
        <div className="relative mt-1 h-5 text-xs text-muted-foreground">
          <span className="absolute -translate-x-full whitespace-nowrap font-medium text-amber-ink" style={{ left: w(row.par) }}>
            Par {fmtVolume(row.par)}
          </span>
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="flex items-center gap-2 text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-sm bg-primary" aria-hidden="true" />
              Lead-time demand
            </dt>
            <dd className="font-semibold tabular-nums">{fmtVolume(row.leadTimeDemand)}</dd>
            <dd className="text-xs text-muted-foreground">{fmtVolume(row.forecastPerDay)} a day x {leadTime} days</dd>
          </div>
          <div>
            <dt className="flex items-center gap-2 text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-sm bg-primary/45" aria-hidden="true" />
              Safety stock
            </dt>
            <dd className="font-semibold tabular-nums">{fmtVolume(row.safetyStock)}</dd>
            <dd className="text-xs text-muted-foreground">{def.z !== null ? `${def.z} x error ${fmtVolume(row.rmse)} x sqrt(${leadTime})` : "None"}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-2 text-muted-foreground">
              <span className="h-2.5 w-[3px] rounded-sm bg-accent" aria-hidden="true" />
              {def.kind === "fixed" ? "Reorder point plus order" : "Par and reorder point"}
            </dt>
            <dd className="font-semibold tabular-nums">{fmtVolume(row.par)}</dd>
            <dd className="text-xs text-muted-foreground">{def.kind === "fixed" ? "One week of average demand per order" : "Order up to this when position falls below it"}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
