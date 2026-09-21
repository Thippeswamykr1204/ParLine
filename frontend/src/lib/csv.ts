/** Minimal RFC-4180 CSV parser. Zero dependencies so the data layer runs identically in the browser and in Node tests. */
export type CsvRow = Record<string, string>;

export function parseCsv(text: string): CsvRow[] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushRow = () => {
    row.push(field);
    field = "";
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      pushRow();
    } else field += c;
  }
  if (field !== "" || row.length > 0) pushRow();

  if (rows.length === 0) return [];
  const header = rows[0];
  const out: CsvRow[] = new Array(rows.length - 1);
  for (let r = 1; r < rows.length; r++) {
    const rec: CsvRow = {};
    const cells = rows[r];
    for (let c = 0; c < header.length; c++) rec[header[c]] = cells[c] ?? "";
    out[r - 1] = rec;
  }
  return out;
}

/** Numeric cell -> number. Empty / missing -> NaN (never silently 0: callers must decide). */
export function num(v: string | undefined): number {
  if (v === undefined || v === "") return NaN;
  return Number(v);
}
