// @category: parsing
// Reads a CSV with quoted fields, aggregates revenue per region and product, and writes a CSV
// report plus a JSON summary.
import { readFileSync, writeFileSync } from "node:fs";

type Row = Record<string, string>;

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

function parseCsv(text: string): Row[] {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  const header = parseCsvLine(lines[0]!);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Row = {};
    header.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    return row;
  });
}

function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const rows = parseCsv(readFileSync("fixtures/sales.csv", "utf8"));
const byRegion = new Map<string, number>();
const byProduct = new Map<string, { units: number; revenue: number }>();
let grand = 0;

for (const row of rows) {
  const units = Number(row["units"]);
  const price = Number(row["unit_price"]);
  const revenue = units * price;
  grand += revenue;
  const region = row["region"] ?? "?";
  byRegion.set(region, (byRegion.get(region) ?? 0) + revenue);
  const product = row["product"] ?? "?";
  const p = byProduct.get(product) ?? { units: 0, revenue: 0 };
  p.units += units;
  p.revenue += revenue;
  byProduct.set(product, p);
}

const regions = [...byRegion.entries()].sort((a, b) => b[1] - a[1]);
const out: string[] = ["region,revenue,share"];
for (const [region, revenue] of regions) {
  out.push(`${region},${revenue.toFixed(2)},${((revenue / grand) * 100).toFixed(1)}%`);
}
writeFileSync("report.csv", out.join("\n") + "\n");

const products = [...byProduct.entries()]
  .map(([name, p]) => ({ name, units: p.units, revenue: Math.round(p.revenue * 100) / 100 }))
  .sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(
  "summary.json",
  JSON.stringify({ rows: rows.length, total: Math.round(grand * 100) / 100, products }, null, 2),
);

console.log(`processed ${rows.length} rows, total revenue ${grand.toFixed(2)}`);
for (const p of products)
  console.log(`${csvEscape(p.name).padEnd(18)} ${String(p.units).padStart(4)}`);
console.log(`top region: ${regions[0]?.[0]}`);
