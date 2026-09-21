import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Shimmering placeholder. The shimmer is disabled automatically under prefers-reduced-motion (see globals.css). */
function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("relative overflow-hidden rounded-md bg-muted", className)} aria-hidden="true" {...props}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/70 to-transparent" />
    </div>
  );
}

export { Skeleton };
