"use client";

import Link from "next/link";
import { ArrowUpRight, Check, RotateCcw } from "lucide-react";
import { AbcPill } from "@/components/shared/status";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { RecKind, Recommendation } from "@/lib/engine/inventory";
import { shortBar } from "@/lib/format";
import { cn } from "@/lib/utils";

export const REC_META: Record<RecKind, { label: string; variant: NonNullable<BadgeProps["variant"]>; stripe: string; doneLabel: string }> = {
  stockout: { label: "Out of stock", variant: "critical", stripe: "bg-critical", doneLabel: "Mark as ordered" },
  reorder: { label: "Reorder now", variant: "warning", stripe: "bg-warning", doneLabel: "Mark as ordered" },
  watch: { label: "Plan ahead", variant: "low", stripe: "bg-accent", doneLabel: "Mark as scheduled" },
  overstock: { label: "Excess stock", variant: "over", stripe: "bg-over", doneLabel: "Mark as reviewed" },
};

interface RecCardProps {
  rec: Recommendation;
  done?: boolean;
  onToggleDone?: (id: string) => void;
  compact?: boolean;
}

export function RecCard({ rec, done = false, onToggleDone, compact = false }: RecCardProps) {
  const meta = REC_META[rec.kind];
  return (
    <article className={cn("relative flex overflow-hidden rounded-panel border bg-card shadow-panel transition-opacity", done && "opacity-55")}>
      <span className={cn("w-1.5 shrink-0", meta.stripe)} aria-hidden="true" />
      <div className="min-w-0 flex-1 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={meta.variant}>{meta.label}</Badge>
          <AbcPill abc={rec.row.abc} />
          <span className="text-[13px] text-muted-foreground">{shortBar(rec.row.bar)}</span>
        </div>
        <h3 className={cn("mt-2 font-semibold leading-snug", compact ? "text-[15px]" : "text-[17px]", done && "line-through decoration-muted-foreground/50")}>{rec.title}</h3>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">{rec.summary}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          {rec.facts.map((f) => (
            <div key={f.label}>
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd className="text-sm font-semibold tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/items/${rec.row.id}`}>
              Open item
              <ArrowUpRight />
            </Link>
          </Button>
          {onToggleDone && !compact && (
            <Button variant={done ? "ghost" : "secondary"} size="sm" onClick={() => onToggleDone(rec.id)}>
              {done ? <RotateCcw /> : <Check />}
              {done ? "Undo" : meta.doneLabel}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
