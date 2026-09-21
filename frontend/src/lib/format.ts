/** Pure formatting + id helpers. No UI dependencies, so the engine and Node tests can import it. */

const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const one = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const two = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export const fmtInt = (n: number) => (Number.isFinite(n) ? int.format(Math.round(n)) : "n/a");
export const fmt1 = (n: number) => (Number.isFinite(n) ? one.format(n) : "n/a");
export const fmt2 = (n: number) => (Number.isFinite(n) ? two.format(n) : "n/a");
export const fmtPct = (n: number, digits = 0) => (Number.isFinite(n) ? `${n.toFixed(digits)}%` : "n/a");

/** Volume: ml under 1 L, litres above. */
export function fmtVolume(ml: number): string {
  if (!Number.isFinite(ml)) return "n/a";
  const abs = Math.abs(ml);
  if (abs >= 1000) return `${(ml / 1000).toFixed(abs >= 10000 ? 1 : 2)} L`;
  return `${Math.round(ml)} ml`;
}

export function fmtDays(d: number | null): string {
  if (d === null || !Number.isFinite(d)) return "No demand";
  if (d >= 100) return `${Math.round(d)} d`;
  return `${d.toFixed(1)} d`;
}

/** 'YYYY-MM-DD' -> Date at UTC midnight (no timezone drift). */
export function parseDay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function fmtDate(s: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(parseDay(s));
}
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
export function seriesId(bar: string, brand: string): string {
  return `${slug(bar)}--${slug(brand)}`;
}
export function shortBar(bar: string): string {
  return bar.replace(/'s Bar$/, "");
}
