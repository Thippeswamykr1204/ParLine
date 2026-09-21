import { AlertTriangle, CheckCircle2, Layers, PackageX, TrendingDown, type LucideIcon } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { AbcClass, Status } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface StatusMeta {
  label: string;
  variant: NonNullable<BadgeProps["variant"]>;
  icon: LucideIcon;
  /** Solid colour class for gauges and dots. */
  solid: string;
  hint: string;
}

export const STATUS_META: Record<Status, StatusMeta> = {
  out: { label: "Out of stock", variant: "critical", icon: PackageX, solid: "bg-critical", hint: "Nothing on hand." },
  risk: { label: "At risk", variant: "warning", icon: AlertTriangle, solid: "bg-warning", hint: "On hand is below the reorder point." },
  low: { label: "Low stock", variant: "low", icon: TrendingDown, solid: "bg-low", hint: "Above the reorder point but under twice its level." },
  healthy: { label: "Healthy", variant: "success", icon: CheckCircle2, solid: "bg-success", hint: "Comfortably covered." },
  over: { label: "Overstocked", variant: "over", icon: Layers, solid: "bg-over", hint: "Far more on hand than the policy needs." },
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const m = STATUS_META[status];
  const Icon = m.icon;
  return (
    <Badge variant={m.variant} className={className}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {m.label}
    </Badge>
  );
}

const ABC_STYLE: Record<AbcClass, string> = {
  A: "bg-primary text-primary-foreground",
  B: "bg-secondary text-secondary-foreground",
  C: "border bg-card text-muted-foreground",
};
const ABC_TITLE: Record<AbcClass, string> = {
  A: "Class A: high-velocity, top share of volume",
  B: "Class B: moderate velocity",
  C: "Class C: slow-moving",
};

export function AbcPill({ abc, className }: { abc: AbcClass; className?: string }) {
  return (
    <span
      title={ABC_TITLE[abc]}
      className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[11px] font-semibold", ABC_STYLE[abc], className)}
    >
      {abc}
    </span>
  );
}
