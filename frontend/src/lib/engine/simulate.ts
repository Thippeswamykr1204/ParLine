/**
 * Port of `simulate_series` from src/data/tier4_simulation.py, extended to keep a day-by-day trace.
 * The control flow and arithmetic are intentionally identical; tests/parity.test.ts proves the aggregate
 * numbers reproduce tier4_perseries_*.csv and tier4_policy_comparison.csv exactly.
 *
 * Per day:
 *   1. receive orders whose lead time has elapsed
 *   2. inventory position = on-hand + in transit
 *   3. if position < reorder point: order (par - position, or a fixed qty)
 *   4. deduct actual demand; shortfall is lost volume and floors stock at 0
 *   5. log end-of-day on-hand
 */
export interface SimDay {
  day: number;
  date: string;
  demand: number;
  received: number;
  orderQty: number;
  onHandStart: number;
  onHand: number;
  inTransit: number;
  position: number;
  stockout: boolean;
  lost: number;
}

export interface SimSummary {
  stockoutDays: number;
  stockoutRatePct: number;
  lostVolumeMl: number;
  avgHoldingMl: number;
  turnover: number;
  nOrders: number;
  nDays: number;
}

export interface SimResult {
  summary: SimSummary;
  days: SimDay[];
  par: number | null;
  reorderPoint: number;
}

export interface SimOptions {
  leadTime: number;
  reorderPoint: number;
  par?: number | null;
  fixedOrderQty?: number | null;
  initialStock?: number;
}

export function simulateSeries(demand: number[], dates: string[], opts: SimOptions): SimResult {
  const hasPar = opts.par !== undefined && opts.par !== null;
  const hasFixed = opts.fixedOrderQty !== undefined && opts.fixedOrderQty !== null;
  if (hasPar === hasFixed) throw new Error("simulateSeries: provide exactly one of par / fixedOrderQty");

  const par = hasPar ? (opts.par as number) : null;
  const fixed = hasFixed ? (opts.fixedOrderQty as number) : null;
  let stock = opts.initialStock ?? (hasPar ? (par as number) : opts.reorderPoint + (fixed as number));

  let pending: Array<[number, number]> = [];
  let stockoutDays = 0;
  let lost = 0;
  let nOrders = 0;
  let totalDemand = 0;
  let holdingSum = 0;
  const days: SimDay[] = new Array(demand.length);

  for (let i = 0; i < demand.length; i++) {
    const d = demand[i];
    totalDemand += d;

    for (const o of pending) o[0] -= 1;
    let received = 0;
    for (const o of pending) if (o[0] <= 0) received += o[1];
    // add arrivals to stock one by one to mirror the reference float arithmetic
    for (const o of pending) if (o[0] <= 0) stock += o[1];
    pending = pending.filter((o) => o[0] > 0);
    const onHandStart = stock;

    let inTransit = 0;
    for (const o of pending) inTransit += o[1];
    const position = stock + inTransit;

    let orderQty = 0;
    if (position < opts.reorderPoint) {
      const q = hasPar ? Math.max((par as number) - position, 0) : (fixed as number);
      if (q > 0) {
        pending.push([opts.leadTime, q]);
        nOrders += 1;
        orderQty = q;
      }
    }

    let stockout = false;
    let lostToday = 0;
    if (stock >= d) stock -= d;
    else {
      lostToday = d - stock;
      lost += lostToday;
      stockoutDays += 1;
      stockout = true;
      stock = 0;
    }
    holdingSum += stock;

    days[i] = {
      day: i + 1,
      date: dates[i],
      demand: d,
      received,
      orderQty,
      onHandStart,
      onHand: stock,
      inTransit: inTransit + orderQty,
      position: position + orderQty,
      stockout,
      lost: lostToday,
    };
  }

  const n = demand.length;
  const avgHolding = n > 0 ? holdingSum / n : 0;
  const fulfilled = totalDemand - lost;
  return {
    summary: {
      stockoutDays,
      stockoutRatePct: n > 0 ? (stockoutDays / n) * 100 : 0,
      lostVolumeMl: lost,
      avgHoldingMl: avgHolding,
      turnover: avgHolding > 0 ? fulfilled / avgHolding : NaN,
      nOrders,
      nDays: n,
    },
    days,
    par,
    reorderPoint: opts.reorderPoint,
  };
}
