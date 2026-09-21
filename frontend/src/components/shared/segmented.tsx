"use client";

import { useId, type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
}

interface SegmentedProps<T extends string> {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
  className?: string;
}

/** Segmented single-select. The active pill slides between options (a response to the user's click). */
export function Segmented<T extends string>({ options, value, onChange, ariaLabel, size = "md", className }: SegmentedProps<T>) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-secondary p-0.5 scrollbar-thin", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative whitespace-nowrap rounded-md font-medium transition-colors",
              size === "sm" ? "h-7 px-2.5 text-[13px]" : "h-8 px-3 text-sm",
              active ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-md bg-card shadow-[0_1px_2px_rgba(18,36,74,0.18)]"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {o.label}
              {o.count !== undefined && (
                <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", active ? "bg-secondary text-primary" : "bg-card/60")}>{o.count}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
