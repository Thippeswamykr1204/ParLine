"use client";

import { useApp } from "@/components/providers/app-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtVolume } from "@/lib/format";
import { cn } from "@/lib/utils";

const LEVELS = ["90%", "95%", "99%"];
const LEAD_TIMES = [2, 3, 5];

/** Tier 3 sensitivity grid for this item, read straight from tier3_par_level_full_grid.csv. */
export function ParLadder({ id }: { id: string }) {
  const { ds } = useApp();
  const rows = ds?.gridBySeries.get(id);
  if (!rows) return null;
  const cell = (sl: string, lt: number) => rows.find((r) => r.serviceLevel === sl && r.leadTimeDays === lt);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Par level by service level and lead time</CardTitle>
        <CardDescription>
          From the Tier 3 grid, which uses the 7-day moving-average forecast. Use it to see how much buffer a longer delivery or a higher target adds for this item.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[13px] text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Service level</th>
                {LEAD_TIMES.map((lt) => (
                  <th key={lt} className="px-3 py-2 text-right font-medium">
                    {lt}-day lead time
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LEVELS.map((sl) => (
                <tr key={sl} className="border-t">
                  <th scope="row" className="py-2.5 pr-3 text-left font-medium">
                    {sl}
                  </th>
                  {LEAD_TIMES.map((lt) => {
                    const c = cell(sl, lt);
                    const isDefault = sl === "95%" && lt === 2;
                    return (
                      <td key={lt} className={cn("px-3 py-2.5 text-right tabular-nums", isDefault && "rounded bg-accent/15 font-semibold")}>
                        {c ? fmtVolume(c.par) : "n/a"}
                        {c && <div className="text-xs font-normal text-muted-foreground">{fmtVolume(c.safetyStock)} safety</div>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Highlighted: the Tier 3 default (95% service level, 2-day lead time).</p>
      </CardContent>
    </Card>
  );
}
