"use client";

import { CheckCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { useApp } from "@/components/providers/app-provider";
import { RecCard } from "@/components/recs/rec-card";
import { Segmented } from "@/components/shared/segmented";
import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { RecKind } from "@/lib/engine/inventory";
import { fmtVolume } from "@/lib/format";

type KindFilter = "all" | RecKind;
const PAGE = 15;

export function RecFeed() {
  const { ds, recs, done, toggleDone } = useApp();
  const [kind, setKind] = useState<KindFilter>("all");
  const [hideDone, setHideDone] = useState(true);
  const [shown, setShown] = useState(PAGE);

  const counts = useMemo(() => {
    const c: Record<KindFilter, number> = { all: 0, stockout: 0, reorder: 0, watch: 0, overstock: 0 };
    for (const r of recs) {
      if (hideDone && done.has(r.id)) continue;
      c.all += 1;
      c[r.kind] += 1;
    }
    return c;
  }, [recs, done, hideDone]);

  const summary = useMemo(() => {
    let order = 0;
    let excess = 0;
    for (const r of recs) {
      if (done.has(r.id)) continue;
      if (r.kind === "stockout" || r.kind === "reorder") order += r.volumeMl;
      if (r.kind === "overstock") excess += r.volumeMl;
    }
    return { order, excess };
  }, [recs, done]);

  const list = useMemo(() => recs.filter((r) => (kind === "all" || r.kind === kind) && !(hideDone && done.has(r.id))), [recs, kind, hideDone, done]);
  const doneCount = recs.filter((r) => done.has(r.id)).length;

  if (!ds) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-panel" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-px overflow-hidden rounded-panel border bg-border shadow-panel sm:grid-cols-3">
        <div className="bg-card p-4">
          <div className="text-[13px] text-muted-foreground">To order now</div>
          <div className="font-display text-[26px] font-semibold leading-tight tabular-nums">{fmtVolume(summary.order)}</div>
          <div className="text-xs text-muted-foreground">{counts.stockout + counts.reorder} items, ordered up to par</div>
        </div>
        <div className="bg-card p-4">
          <div className="text-[13px] text-muted-foreground">Held above par</div>
          <div className="font-display text-[26px] font-semibold leading-tight tabular-nums">{fmtVolume(summary.excess)}</div>
          <div className="text-xs text-muted-foreground">{counts.overstock} overstocked items to pause</div>
        </div>
        <div className="bg-card p-4">
          <div className="text-[13px] text-muted-foreground">Actioned</div>
          <div className="font-display text-[26px] font-semibold leading-tight tabular-nums">{doneCount}</div>
          <div className="text-xs text-muted-foreground">Saved in this browser only</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          ariaLabel="Recommendation type"
          value={kind}
          onChange={(k) => {
            setKind(k);
            setShown(PAGE);
          }}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "stockout", label: "Out of stock", count: counts.stockout },
            { value: "reorder", label: "Reorder now", count: counts.reorder },
            { value: "watch", label: "Plan ahead", count: counts.watch },
            { value: "overstock", label: "Excess stock", count: counts.overstock },
          ]}
        />
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} className="h-4 w-4 accent-[hsl(219,61%,18%)]" />
          Hide actioned
        </label>
      </div>

      {list.length === 0 ? (
        <div className="rounded-panel border bg-card">
          <EmptyState title="Nothing to action here" description="Every recommendation of this type for the selected bar is done, or none apply under the current policy." />
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {list.slice(0, shown).map((r) => (
              <RecCard key={r.id} rec={r} done={done.has(r.id)} onToggleDone={toggleDone} />
            ))}
          </div>
          <div className="flex flex-col items-center gap-2 pt-2">
            {shown < list.length ? (
              <Button variant="outline" onClick={() => setShown((s) => s + PAGE)}>
                Show {Math.min(PAGE, list.length - shown)} more
              </Button>
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CheckCheck className="h-4 w-4" aria-hidden="true" />
                That is all {list.length}.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
