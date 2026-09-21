"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Boxes, LayoutDashboard, ListChecks, PlayCircle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/shared/logo";
import { AgentDrawer } from "@/components/shared/agent-drawer";
import { useApp } from "@/components/providers/app-provider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SELECTABLE_POLICIES, POLICIES } from "@/lib/engine/policy";
import { RECOMMENDED_POLICY } from "@/lib/config";
import { fmtDate } from "@/lib/format";
import type { PolicyId } from "@/lib/types";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (p: string) => boolean;
}
const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, match: (p) => p === "/" },
  { href: "/inventory", label: "Inventory", icon: Boxes, match: (p) => p.startsWith("/inventory") || p.startsWith("/items") },
  { href: "/simulation", label: "Simulation", icon: PlayCircle, match: (p) => p.startsWith("/simulation") },
  { href: "/recommendations", label: "Recommendations", icon: ListChecks, match: (p) => p.startsWith("/recommendations") },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { ds, bar, setBar, policy, setPolicy, recs, done } = useApp();
  const open = recs.filter((r) => (r.severity === "critical" || r.severity === "high") && !done.has(r.id)).length;

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="container flex flex-wrap items-center gap-x-6 gap-y-2 py-2.5">
          <Link href="/" className="flex items-center gap-2.5 rounded-lg" aria-label="ParLine home">
            <LogoMark className="h-8 w-8" />
            <span className="font-display text-xl font-semibold tracking-tight">ParLine</span>
          </Link>

          <nav aria-label="Primary" className="order-3 -mx-1 flex w-full items-center gap-1 overflow-x-auto scrollbar-thin md:order-none md:mx-0 md:w-auto">
            {NAV.map((item) => {
              const active = item.match(pathname);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-10 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors",
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                  {item.href === "/recommendations" && open > 0 && (
                    <span className="rounded-full bg-critical px-1.5 text-[11px] font-semibold leading-[18px] text-white tabular-nums" aria-label={`${open} urgent`}>
                      {open}
                    </span>
                  )}
                  {active && <motion.span layoutId="nav-par-line" className="absolute inset-x-3 -bottom-[7px] h-[3px] rounded-full bg-accent" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Select value={bar} onValueChange={setBar} disabled={!ds}>
              <SelectTrigger className="w-[9.5rem]" aria-label="Bar">
                <SelectValue placeholder="All bars" />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="all">All bars</SelectItem>
                {ds?.bars.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={policy} onValueChange={(v) => setPolicy(v as PolicyId)}>
              <SelectTrigger className="w-[12.5rem]" aria-label="Ordering policy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {SELECTABLE_POLICIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {POLICIES[p].short}
                    {p === RECOMMENDED_POLICY ? " (recommended)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      <motion.main
        id="main"
        key={pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="container flex-1 py-8"
      >
        {children}
      </motion.main>

      <footer className="border-t py-5 text-[13px] text-muted-foreground">
        <div className="container flex flex-wrap items-center justify-between gap-2">
          <span>
            {ds
              ? `Ledger balances as of ${fmtDate(ds.asOf)}. Backtest window ${fmtDate(ds.validationDates[0], { day: "numeric", month: "short" })} to ${fmtDate(ds.validationDates[ds.validationDates.length - 1])}.`
              : "Loading pipeline outputs"}
          </span>
        </div>
      </footer>

      <AgentDrawer />
    </div>
  );
}
