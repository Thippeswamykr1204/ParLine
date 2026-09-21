import { STATUS_META } from "@/components/shared/status";
import { fmtVolume } from "@/lib/format";
import type { Status } from "@/lib/types";
import { cn } from "@/lib/utils";

interface StockGaugeProps {
  onHand: number;
  par: number;
  reorderPoint: number;
  status: Status;
  /** The full bar represents this many x par. */
  scale?: number;
  className?: string;
}

/** Thin bar showing on-hand against the par line. The amber tick is the par level (and reorder point). */
export function StockGauge({ onHand, par, reorderPoint, status, scale = 3, className }: StockGaugeProps) {
  const max = Math.max(par * scale, onHand, 1);
  const fill = Math.min(onHand / max, 1) * 100;
  const parPos = Math.min(par / max, 1) * 100;
  const ropPos = Math.min(reorderPoint / max, 1) * 100;
  const separate = Math.abs(parPos - ropPos) > 1.5;
  return (
    <div
      className={cn("relative h-1.5 w-full rounded-full bg-muted", className)}
      role="img"
      aria-label={`${fmtVolume(onHand)} on hand against a par level of ${fmtVolume(par)}`}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-500", STATUS_META[status].solid)} style={{ width: `${fill}%` }} />
      <span className="absolute -top-[3px] h-3 w-[3px] rounded-full bg-accent" style={{ left: `calc(${parPos}% - 1.5px)` }} />
      {separate && <span className="absolute -top-[2px] h-2.5 w-px bg-foreground/60" style={{ left: `${ropPos}%` }} />}
    </div>
  );
}
