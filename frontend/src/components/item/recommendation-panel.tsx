import { CheckCircle2, PackageX, TrendingDown, AlertTriangle, Layers, type LucideIcon } from "lucide-react";
import type { InventoryRow } from "@/lib/engine/inventory";
import { fmtDays, fmtVolume } from "@/lib/format";
import type { Status } from "@/lib/types";
import { cn } from "@/lib/utils";

const TONE: Record<Status, { bg: string; ink: string; icon: LucideIcon }> = {
  out: { bg: "bg-critical-soft", ink: "text-critical", icon: PackageX },
  risk: { bg: "bg-warning-soft", ink: "text-warning", icon: AlertTriangle },
  low: { bg: "bg-low-soft", ink: "text-low", icon: TrendingDown },
  healthy: { bg: "bg-success-soft", ink: "text-success", icon: CheckCircle2 },
  over: { bg: "bg-over-soft", ink: "text-over", icon: Layers },
};

function copy(r: InventoryRow, leadTime: number): { headline: string; body: string } {
  const cover = fmtDays(r.daysCover);
  const stale = r.stale && r.readingAgeDays !== null ? ` The last count is ${r.readingAgeDays} days old, so confirm it first.` : "";
  switch (r.status) {
    case "out":
      return {
        headline: `Order ${fmtVolume(r.orderQty)} now`,
        body: `Nothing is on hand and the policy expects ${fmtVolume(r.forecastPerDay)} of demand a day. Ordering up to the ${fmtVolume(r.par)} par level covers the ${leadTime}-day delivery plus the safety buffer.${stale}`,
      };
    case "risk":
      return {
        headline: `Order ${fmtVolume(r.orderQty)} now`,
        body: `${fmtVolume(r.onHand)} on hand is under the ${fmtVolume(r.reorderPoint)} reorder point, about ${cover} of cover against a ${leadTime}-day delivery. Ordering up to par restores the buffer.${stale}`,
      };
    case "low":
      return {
        headline: `Reorder point in about ${r.daysToReorder === null ? "n/a" : r.daysToReorder < 1 ? "a day" : `${Math.round(r.daysToReorder)} days`}`,
        body: `${fmtVolume(r.onHand)} on hand is within twice the reorder point. No order yet; add it to the next delivery.${stale}`,
      };
    case "over":
      return r.forecastPerDay <= 0
        ? { headline: "Check whether this item is still sold", body: `${fmtVolume(r.onHand)} is on hand and the policy forecasts no demand.` }
        : {
            headline: "Pause reordering",
            body: `${fmtVolume(r.onHand)} on hand is ${(r.onHand / r.par).toFixed(1)} times the ${fmtVolume(r.par)} par level, about ${cover} of cover. The next order is roughly ${fmtDays(r.daysToReorder)} away.${stale}`,
          };
    default:
      return {
        headline: "No action needed",
        body: `${fmtVolume(r.onHand)} on hand covers about ${cover}. The reorder point is roughly ${fmtDays(r.daysToReorder)} away.${stale}`,
      };
  }
}

export function RecommendationPanel({ row, leadTime }: { row: InventoryRow; leadTime: number }) {
  const t = TONE[row.status];
  const Icon = t.icon;
  const c = copy(row, leadTime);
  return (
    <section aria-label="Recommendation" className={cn("rounded-panel p-5 sm:p-6", t.bg)}>
      <div className={cn("flex items-center gap-2 text-sm font-medium", t.ink)}>
        <Icon className="h-4 w-4" aria-hidden="true" />
        Recommendation
      </div>
      <h2 className="mt-2 text-[26px] font-semibold leading-tight">{c.headline}</h2>
      <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-foreground/80">{c.body}</p>
    </section>
  );
}
