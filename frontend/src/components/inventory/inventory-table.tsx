"use client";

import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Clock, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useApp } from "@/components/providers/app-provider";
import { Segmented } from "@/components/shared/segmented";
import { EmptyState } from "@/components/shared/states";
import { AbcPill, StatusBadge } from "@/components/shared/status";
import { StockGauge } from "@/components/shared/stock-gauge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OVERSTOCK_OPTIONS, STATUS_RULES } from "@/lib/config";
import { STATUS_ORDER, type InventoryRow } from "@/lib/engine/inventory";
import { POLICIES } from "@/lib/engine/policy";
import { fmtDays, fmtVolume, shortBar } from "@/lib/format";
import type { Status } from "@/lib/types";
import { cn } from "@/lib/utils";

type Filter = "all" | "low" | "over" | "risk" | "out";
const FILTERS: Filter[] = ["all", "low", "over", "risk", "out"];
const FILTER_STATUS: Record<Exclude<Filter, "all">, Status> = { low: "low", over: "over", risk: "risk", out: "out" };

type SortKey = "urgency" | "item" | "onHand" | "forecast" | "par" | "rop" | "cover" | "order";
type Dir = "asc" | "desc";

const SORTERS: Record<SortKey, (r: InventoryRow) => number | string> = {
  urgency: (r) => STATUS_ORDER[r.status] * 1e6 + (r.daysCover ?? 1e5),
  item: (r) => `${r.brand} ${r.bar}`,
  onHand: (r) => r.onHand,
  forecast: (r) => r.forecastPerDay,
  par: (r) => r.par,
  rop: (r) => r.reorderPoint,
  cover: (r) => r.daysCover ?? Number.POSITIVE_INFINITY,
  order: (r) => r.orderQty,
};

function parseFilter(v: string | null): Filter {
  return FILTERS.includes(v as Filter) ? (v as Filter) : "all";
}

export function InventoryTable() {
  const { status, ds, rows, policy, overstock, setOverstock } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filter = parseFilter(params.get("status"));
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: "urgency", dir: "asc" });

  const setFilter = (f: Filter) => {
    const next = new URLSearchParams(params.toString());
    if (f === "all") next.delete("status");
    else next.set("status", f);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rows.length, low: 0, over: 0, risk: 0, out: 0 };
    for (const r of rows) {
      if (r.status === "low") c.low += 1;
      else if (r.status === "over") c.over += 1;
      else if (r.status === "risk") c.risk += 1;
      else if (r.status === "out") c.out += 1;
    }
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) => (filter === "all" || r.status === FILTER_STATUS[filter]) && (!q || `${r.brand} ${r.bar} ${r.alcoholType}`.toLowerCase().includes(q)));
    const get = SORTERS[sort.key];
    return [...list].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      const c = typeof x === "string" && typeof y === "string" ? x.localeCompare(y) : (x as number) - (y as number);
      return sort.dir === "asc" ? c : -c;
    });
  }, [rows, filter, query, sort]);

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "item" ? "asc" : key === "urgency" ? "asc" : "desc" }));

  const head = (key: SortKey, label: string, align: "left" | "right" = "right") => {
    const active = sort.key === key;
    const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <TableHead className={cn(align === "right" && "text-right")} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" onClick={() => toggleSort(key)} className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}>
          {label}
          <Icon className={cn("h-3.5 w-3.5", !active && "opacity-40")} aria-hidden="true" />
        </button>
      </TableHead>
    );
  };

  if (status === "loading" || !ds) return <TableSkeleton />;

  const fixed = POLICIES[policy].kind === "fixed";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          ariaLabel="Stock status filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "low", label: "Low stock", count: counts.low },
            { value: "over", label: "Overstocked", count: counts.over },
            { value: "risk", label: "At risk", count: counts.risk },
            { value: "out", label: "Out of stock", count: counts.out },
          ]}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search brand or bar" aria-label="Search inventory" className="w-56 pl-8" />
          </div>
          <Select value={String(overstock)} onValueChange={(v) => setOverstock(Number(v))}>
            <SelectTrigger className="w-[11.5rem]" aria-label="Overstock threshold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {OVERSTOCK_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  Overstocked at {n}x par
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <Table className="min-w-[1080px]">
            <TableHeader className="sticky top-0 bg-card">
              <TableRow className="hover:bg-transparent">
                {head("item", "Item", "left")}
                <TableHead>Status</TableHead>
                {head("onHand", "On hand")}
                {head("forecast", "Forecast a day")}
                {head("par", "Par level")}
                {head("rop", "Reorder point")}
                {head("cover", "Cover")}
                {head("order", "Order now")}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => (
                <TableRow key={r.id} className="group cursor-pointer hover:bg-muted/60" onClick={() => router.push(`/items/${r.id}`)}>
                  <TableCell>
                    <Link href={`/items/${r.id}`} className="block rounded outline-offset-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.brand}</span>
                        <AbcPill abc={r.abc} />
                      </div>
                      <div className="text-[13px] text-muted-foreground">
                        {shortBar(r.bar)}, {r.alcoholType.toLowerCase()}
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="w-44 text-right">
                    <div className="flex items-center justify-end gap-1.5 font-medium tabular-nums">
                      {r.stale && r.readingAgeDays !== null && (
                        <span title={`Last counted ${r.readingAgeDays} days before the end of the data`} className="inline-flex text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" aria-label={`Count is ${r.readingAgeDays} days old`} />
                        </span>
                      )}
                      {fmtVolume(r.onHand)}
                    </div>
                    <StockGauge className="ml-auto mt-1.5 w-32" onHand={r.onHand} par={r.par} reorderPoint={r.reorderPoint} status={r.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtVolume(r.forecastPerDay)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fixed ? `${fmtVolume(r.par)}*` : fmtVolume(r.par)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtVolume(r.reorderPoint)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtDays(r.daysCover)}</TableCell>
                  <TableCell className="text-right">
                    {r.orderQty > 0 ? <span className="font-semibold tabular-nums">{fmtVolume(r.orderQty)}</span> : <span className="text-muted-foreground">None</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {visible.length === 0 && (
          <EmptyState
            title="No items match"
            description={query ? `Nothing matches "${query}" with this status filter.` : "No items have this status under the selected policy and bar."}
            action={
              <Button variant="outline" size="sm" onClick={() => { setQuery(""); setFilter("all"); }}>
                Clear filters
              </Button>
            }
          />
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/40 px-4 py-2.5 text-[13px] text-muted-foreground">
          <span>
            Showing {visible.length} of {rows.length} items
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-[3px] rounded-full bg-accent" aria-hidden="true" />
            Amber tick on each bar marks the par level
          </span>
        </div>
      </Card>

      <div className="grid gap-4 text-sm text-muted-foreground md:grid-cols-2">
        <div className="rounded-panel border bg-card p-4">
          <h2 className="mb-2 font-display text-base font-semibold text-foreground">How statuses are decided</h2>
          <ul className="space-y-1 leading-relaxed">
            <li>
              <b className="text-foreground">Out of stock:</b> nothing on hand.
            </li>
            <li>
              <b className="text-foreground">At risk:</b> on hand is below the reorder point, so the simulator would already have ordered.
            </li>
            <li>
              <b className="text-foreground">Low stock:</b> above the reorder point but under {STATUS_RULES.lowMultiple}x it.
            </li>
            <li>
              <b className="text-foreground">Overstocked:</b> on hand is {overstock}x par or more.
            </li>
          </ul>
        </div>
        <div className="rounded-panel border bg-card p-4">
          <h2 className="mb-2 font-display text-base font-semibold text-foreground">What the numbers assume</h2>
          <ul className="space-y-1 leading-relaxed">
            <li>On hand is the latest ledger closing balance. A clock marks counts older than {STATUS_RULES.staleDays} days.</li>
            <li>The data has no purchase-order feed, so order quantities assume nothing is in transit.</li>
            <li>Forecast is the policy&apos;s average daily demand over the backtest window; cover is on hand divided by it.</li>
            {fixed && <li>* The naive rule has no par level; the figure shown is its reorder point plus one fixed order.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function TableSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-[34rem] max-w-full" />
      <Card className="divide-y">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="ml-auto h-9 w-40" />
            <Skeleton className="hidden h-5 w-72 md:block" />
          </div>
        ))}
      </Card>
    </div>
  );
}
