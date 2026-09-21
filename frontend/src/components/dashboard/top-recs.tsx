"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useApp } from "@/components/providers/app-provider";
import { RecCard } from "@/components/recs/rec-card";
import { Skeleton } from "@/components/ui/skeleton";

export function TopRecs() {
  const { ds, recs, done } = useApp();
  if (!ds) return <Skeleton className="h-64 w-full rounded-panel" />;
  const open = recs.filter((r) => !done.has(r.id));
  const top = open.slice(0, 4);

  return (
    <section aria-labelledby="top-recs-title">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 id="top-recs-title" className="text-xl font-semibold">
            What to do first
          </h2>
          <p className="text-sm text-muted-foreground">Highest-priority actions, using each item&apos;s own par level and cover.</p>
        </div>
        <Link href="/recommendations" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline">
          All {open.length} recommendations
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
      {top.length === 0 ? (
        <p className="rounded-panel border bg-card p-6 text-sm text-muted-foreground">No open recommendations for this selection.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {top.map((r) => (
            <RecCard key={r.id} rec={r} compact />
          ))}
        </div>
      )}
    </section>
  );
}
