/**
 * Proves the UI's data layer + simulation port reproduce the verified Tier 0-4 outputs.
 * Run:  npm run test:parity   (uses tsx; no browser needed)
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadDataset } from "../src/lib/data/sources";
import { POLICIES, POLICY_IDS, policyParams, SERVICE_Z } from "../src/lib/engine/policy";
import { checkParity, simulate } from "../src/lib/engine/replay";
import { buildRecommendations, buildRows, classify, computeKpis, scopeRows } from "../src/lib/engine/inventory";
import { demandTrend } from "../src/lib/engine/aggregate";
import { parseCsv } from "../src/lib/csv";
import type { PolicyId } from "../src/lib/types";

async function main() {
  const DATA = join(process.cwd(), "public", "data");
  let passed = 0;
  const ok = (name: string, fn: () => void) => {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  };

  const ds = await loadDataset((f) => readFile(join(DATA, f), "utf8"));
  console.log(`Loaded ${ds.series.length} series, ${ds.bars.length} bars, ledger as of ${ds.asOf}`);

  // ---- CSV parser ------------------------------------------------------------------------------------------------
  ok("csv parser handles quotes, CRLF and BOM", () => {
    const rows = parseCsv('\ufeffa,b\r\n"x,1","he said ""hi"""\r\n2,3\r\n');
    assert.deepEqual(rows, [{ a: "x,1", b: 'he said "hi"' }, { a: "2", b: "3" }]);
  });

  // ---- Data shape ------------------------------------------------------------------------------------------------
  ok("96 series, 6 bars, 16 brands, 366 history days, 74 validation days", () => {
    assert.equal(ds.series.length, 96);
    assert.equal(ds.bars.length, 6);
    assert.equal(new Set(ds.series.map((s) => s.brand)).size, 16);
    assert.equal(ds.historyDates.length, 366);
    assert.equal(ds.validationDates.length, 74);
    for (const s of ds.series) assert.equal(ds.validation.get(s.id)?.length, 74, s.id);
  });
  ok("every series has a ledger reading and 9 grid rows", () => {
    for (const s of ds.series) {
      assert.ok(ds.ledger.get(s.id), `ledger ${s.id}`);
      assert.equal(ds.gridBySeries.get(s.id)?.length, 9, `grid ${s.id}`);
    }
  });

  // ---- Simulation parity: every series, every policy ---------------------------------------------------------------
  for (const pid of POLICY_IDS) {
    ok(`replay reproduces tier4_perseries for "${POLICIES[pid].csvName}" (96 series)`, () => {
      const r = checkParity(ds, pid);
      assert.equal(r.checked, 96);
      assert.deepEqual(r.mismatches, []);
    });
  }

  // ---- Aggregates vs tier4_policy_comparison.csv -----------------------------------------------------------------
  for (const pid of POLICY_IDS) {
    ok(`aggregate KPIs match tier4_policy_comparison for ${POLICIES[pid].short}`, () => {
      const ref = ds.policySummary.get(pid);
      assert.ok(ref, "policy present in comparison table");
      const runs = ds.series.map((s) => simulate(ds, pid, s.id)!.summary);
      const stock = runs.reduce((a, r) => a + r.stockoutDays, 0);
      const lost = runs.reduce((a, r) => a + r.lostVolumeMl, 0);
      const hold = runs.reduce((a, r) => a + r.avgHoldingMl, 0) / runs.length;
      const orders = runs.reduce((a, r) => a + r.nOrders, 0);
      assert.equal(stock, ref.totalStockoutDays);
      assert.equal(orders, ref.totalOrders);
      assert.ok(Math.abs(lost - ref.totalLostVolumeMl) < 0.06, `lost ${lost} vs ${ref.totalLostVolumeMl}`);
      assert.ok(Math.abs(hold - ref.avgHoldingMlPerSeries) < 0.06, `holding ${hold} vs ${ref.avgHoldingMlPerSeries}`);
    });
  }

  ok("headline story: Global ML 99% = 263 stockout days vs naive 584 (-55%); lost volume 127,604 -> 49,380 ml", () => {
    const g = ds.policySummary.get("gml99")!;
    const n = ds.policySummary.get("naive")!;
    assert.equal(g.totalStockoutDays, 263);
    assert.equal(n.totalStockoutDays, 584);
    assert.equal(Math.round((1 - g.totalStockoutDays / n.totalStockoutDays) * 100), 55);
    assert.equal(Math.round(n.totalLostVolumeMl), 127604);
    assert.equal(Math.round(g.totalLostVolumeMl), 49380);
    const best = [...ds.policySummary.entries()].sort((a, b) => a[1].totalStockoutDays - b[1].totalStockoutDays)[0][0];
    assert.equal(best, "gml99");
  });

  ok("forecast winner (rolling mean 7d, WAPE 1.663) is NOT the simulation winner", () => {
    assert.equal(ds.modelComparison[0].model, "Rolling Mean (7d)");
    assert.ok(Math.abs(ds.modelComparison[0].wape - 1.663) < 0.001);
    assert.notEqual(ds.policySummary.get("ma95")!.totalStockoutDays, ds.policySummary.get("gml99")!.totalStockoutDays);
  });

  // ---- Lead-time sensitivity (Global ML 99%) -----------------------------------------------------------------------
  ok("replay at L=3 and L=5 reproduces tier4_leadtime_sensitivity (182 and 128 stockout days)", () => {
    for (const row of ds.leadTimeSensitivity) {
      const runs = ds.series.map((s) => simulate(ds, "gml99", s.id, row.leadTimeDays)!.summary);
      assert.equal(
        runs.reduce((a, r) => a + r.stockoutDays, 0),
        row.totalStockoutDays,
        `L=${row.leadTimeDays}`,
      );
      const lost = runs.reduce((a, r) => a + r.lostVolumeMl, 0);
      assert.ok(Math.abs(lost - row.totalLostVolumeMl) < 0.06, `lost L=${row.leadTimeDays}`);
    }
    assert.deepEqual(ds.leadTimeSensitivity.map((r) => r.totalStockoutDays), [263, 182, 128]);
  });

  // ---- Tier 3 grid cross-check --------------------------------------------------------------------------------------
  ok("Moving-Average 95% policy params equal the Tier 3 grid (L=2, 95%) for every series", () => {
    let checked = 0;
    for (const s of ds.series) {
      const g = ds.gridBySeries.get(s.id)!.find((r) => r.leadTimeDays === 2 && r.serviceLevel === "95%")!;
      const p = policyParams(POLICIES.ma95, ds.inputs.get(s.id)!, 2);
      assert.ok(Math.abs(p.par - g.par) < 0.06, `${s.id} par ${p.par} vs ${g.par}`);
      assert.ok(Math.abs(p.safetyStock - g.safetyStock) < 0.06, `${s.id} ss`);
      assert.ok(Math.abs(p.forecastPerDay - g.avgForecastPerDay) < 0.06, `${s.id} forecast`);
      checked += 1;
    }
    assert.equal(checked, 96);
  });
  ok("grid z-scores match the documented service levels", () => {
    for (const g of ds.grid) assert.ok(Math.abs(g.z - SERVICE_Z[g.serviceLevel]) < 1e-9);
  });

  // ---- Derived inventory layer --------------------------------------------------------------------------------------
  ok("classification rules behave at the boundaries", () => {
    assert.equal(classify(0, 500, 500, 50, 4), "out");
    assert.equal(classify(499, 500, 500, 50, 4), "risk");
    assert.equal(classify(500, 500, 500, 50, 4), "low");
    assert.equal(classify(999, 500, 500, 50, 4), "low");
    assert.equal(classify(1000, 500, 500, 50, 4), "healthy");
    assert.equal(classify(2000, 500, 500, 50, 4), "over");
    assert.equal(classify(0, 0, 0, 0, 4), "healthy");
    assert.equal(classify(300, 0, 0, 0, 4), "over");
  });

  const rows = buildRows(ds, { policy: "gml99", overstockMultiple: 4 });
  ok("inventory rows: status counts and orders are internally consistent", () => {
    assert.equal(rows.length, 96);
    const k = computeKpis(rows);
    assert.equal(k.counts.out + k.counts.risk + k.counts.low + k.counts.healthy + k.counts.over, 96);
    assert.equal(k.counts.out, 5);
    assert.equal(k.counts.risk, 17);
    assert.equal(k.atRiskCount, 22);
    assert.equal(k.ordersNeeded, 22);
    for (const r of rows) {
      if (r.status === "out" || r.status === "risk") assert.ok(r.orderQty > 0, r.id);
      else assert.equal(r.orderQty, 0, r.id);
      if (r.orderQty > 0) assert.ok(Math.abs(r.onHand + r.orderQty - r.par) < 1e-6, `order-up-to ${r.id}`);
    }
    assert.equal(k.policy.stockoutDays, 263);
    assert.equal(k.baseline.stockoutDays, 584);
  });
  ok("bar scoping sums back to the portfolio", () => {
    const sum = ds.bars.reduce((a, b) => a + computeKpis(scopeRows(rows, b)).policy.stockoutDays, 0);
    assert.equal(sum, 263);
  });
  ok("recommendations: one card per actionable row, ordered critical first", () => {
    const recs = buildRecommendations(rows);
    const k = computeKpis(rows);
    assert.equal(recs.length, k.counts.out + k.counts.risk + k.counts.low + k.counts.over);
    const order = ["stockout", "reorder", "watch", "overstock"];
    let last = 0;
    for (const r of recs) {
      const i = order.indexOf(r.kind);
      assert.ok(i >= last, "kinds are non-decreasing");
      last = i;
      assert.ok(r.title.length > 0 && r.summary.length > 0 && r.facts.length >= 2);
    }
    assert.equal(recs[0].kind, "stockout");
  });
  ok("every policy the UI can select produces finite par, ROP and cover", () => {
    for (const pid of ["gml99", "gml95", "hw95", "ma95"] as PolicyId[]) {
      for (const r of buildRows(ds, { policy: pid, overstockMultiple: 4 })) {
        assert.ok(Number.isFinite(r.par) && Number.isFinite(r.reorderPoint) && Number.isFinite(r.forecastPerDay), `${pid} ${r.id}`);
      }
    }
  });

  // ---- Trend aggregation --------------------------------------------------------------------------------------------
  ok("demand trend: totals match history; forecasts only inside validation window", () => {
    const t = demandTrend(ds, "all");
    assert.equal(t.length, 366);
    const totalHist = ds.series.reduce((a, s) => a + ds.history.get(s.id)!.reduce((x, y) => x + y, 0), 0);
    assert.ok(Math.abs(t.reduce((a, p) => a + p.actual, 0) - totalHist) < 1e-6);
    assert.equal(t.filter((p) => p.global_ml !== null).length, 74);
    assert.ok(t.every((p) => (p.global_ml !== null) === p.inValidation));
  });

  console.log(`\n${passed} checks passed`);

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
