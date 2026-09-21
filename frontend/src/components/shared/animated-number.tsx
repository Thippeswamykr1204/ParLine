"use client";

import { useEffect, useRef } from "react";
import { animate, useReducedMotion } from "framer-motion";
import { fmtInt } from "@/lib/format";
import { cn } from "@/lib/utils";

interface AnimatedNumberProps {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}

/**
 * Counts up to `value`. The DOM text is written imperatively (not through React children) so re-renders
 * never fight the animation, and the last displayed value seeds the next run, which keeps it correct under
 * React strict-mode double effects and when the value changes (e.g. switching policy).
 */
export function AnimatedNumber({ value, format = fmtInt, duration = 1.2, className }: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number>(0);
  const reduce = useReducedMotion();
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduce || !Number.isFinite(value)) {
      shown.current = value;
      node.textContent = formatRef.current(value);
      return;
    }
    node.textContent = formatRef.current(shown.current);
    const controls = animate(shown.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        shown.current = v;
        node.textContent = formatRef.current(v);
      },
      onComplete: () => {
        shown.current = value;
        node.textContent = formatRef.current(value);
      },
    });
    return () => controls.stop();
  }, [value, duration, reduce]);

  return <span ref={ref} className={cn("tabular-nums", className)} suppressHydrationWarning />;
}
