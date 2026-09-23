// @category: text
// Renders records as aligned text tables: column type detection (numbers right-aligned),
// header underline, totals row, sorting by a column, and a Markdown table written to a file.
import { writeFileSync } from "node:fs";

type Cell = string | number;
type Row = Cell[];

function render(headers: string[], rows: Row[], style: "plain" | "markdown"): string {
  const numeric = headers.map((_, c) => rows.every((r) => typeof r[c] === "number"));
  const text = (v: Cell | undefined): string =>
    typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : (v ?? "");
  const widths = headers.map((h, c) => Math.max(h.length, ...rows.map((r) => text(r[c]).length)));
  const fmt = (cells: string[]): string => {
    const padded = cells.map((s, c) =>
      numeric[c] ? s.padStart(widths[c]!) : s.padEnd(widths[c]!),
    );
    return style === "markdown" ? `| ${padded.join(" | ")} |` : padded.join("  ").trimEnd();
  };
  const lines = [fmt(headers)];
  if (style === "markdown") {
    lines.push(
      `|${widths.map((w, c) => (numeric[c] ? "-".repeat(w + 1) + ":" : "-".repeat(w + 2))).join("|")}|`,
    );
  } else {
    lines.push(widths.map((w) => "=".repeat(w)).join("  "));
  }
  for (const r of rows) lines.push(fmt(r.map(text)));
  return lines.join("\n");
}

const headers = ["Language", "Year", "Creator", "Stars (k)"];
const data: Row[] = [
  ["TypeScript", 2012, "Hejlsberg", 98.5],
  ["Rust", 2010, "Hoare", 95.25],
  ["Go", 2009, "Griesemer, Pike, Thompson", 120],
  ["Zig", 2016, "Kelley", 31.1],
  ["OCaml", 1996, "Leroy et al.", 5.4],
];

console.log(render(headers, data, "plain"));
console.log();
const byYear = [...data].sort((a, b) => (a[1] as number) - (b[1] as number));
const total = data.reduce((s, r) => s + (r[3] as number), 0);
console.log(render(headers, [...byYear, ["TOTAL", data.length, "", total]], "plain"));
const md = render(headers, byYear, "markdown");
writeFileSync("languages.md", `# Languages\n\n${md}\n`);
console.log();
console.log(md);
