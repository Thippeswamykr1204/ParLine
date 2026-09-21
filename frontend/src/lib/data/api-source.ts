import type { ReadText } from "./sources";

/**
 * Optional Tier 6 data source. The API serves the database back as the exact CSV files the static mode reads
 * (GET {base}/api/v1/export/<file>), so loadDataset() and the whole TypeScript engine run unchanged on top of it.
 * That is what keeps the Tier 5 parity guarantee intact: same parser, same engine, same file schemas.
 */
export function makeApiReader(baseUrl: string): ReadText {
  const base = baseUrl.replace(/\/+$/, "");
  return async (file) => {
    const res = await fetch(`${base}/api/v1/export/${file}`);
    if (!res.ok) {
      throw new Error(`API could not serve ${file} (HTTP ${res.status}). Is the backend up? Try "docker-compose up" or set NEXT_PUBLIC_DATA_SOURCE=static.`);
    }
    return res.text();
  };
}
