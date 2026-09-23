// @category: parsing
// Joins two CSV files on a key (inner, left and anti joins), groups the result, and writes the
// joined table as CSV.
import { readFileSync, writeFileSync } from "node:fs";

type Table = { header: string[]; rows: string[][] };

function loadCsv(path: string): Table {
  const lines = readFileSync(path, "utf8").trim().split("\n");
  const header = (lines.shift() ?? "").split(",");
  return { header, rows: lines.map((l) => l.split(",")) };
}

function column(t: Table, name: string): number {
  const i = t.header.indexOf(name);
  if (i === -1) throw new Error(`no column ${name} in [${t.header.join(", ")}]`);
  return i;
}

function join(
  left: Table,
  lkey: string,
  right: Table,
  rkey: string,
  kind: "inner" | "left" | "anti",
): Table {
  const li = column(left, lkey);
  const ri = column(right, rkey);
  const index = new Map<string, string[][]>();
  for (const row of right.rows) {
    const k = row[ri] ?? "";
    const bucket = index.get(k) ?? [];
    bucket.push(row);
    index.set(k, bucket);
  }
  const rightCols = right.header.filter((_, i) => i !== ri);
  const out: string[][] = [];
  for (const row of left.rows) {
    const matches = index.get(row[li] ?? "") ?? [];
    if (kind === "anti") {
      if (matches.length === 0) out.push(row);
      continue;
    }
    if (matches.length === 0 && kind === "left") out.push([...row, ...rightCols.map(() => "")]);
    for (const m of matches) out.push([...row, ...m.filter((_, i) => i !== ri)]);
  }
  return { header: kind === "anti" ? left.header : [...left.header, ...rightCols], rows: out };
}

function project(t: Table, cols: string[]): Table {
  const idx = cols.map((c) => column(t, c));
  return { header: cols, rows: t.rows.map((r) => idx.map((i) => r[i] ?? "")) };
}

function show(t: Table): string {
  return [t.header.join(" | "), ...t.rows.map((r) => r.join(" | "))].join("\n");
}

const students = loadCsv("fixtures/students.csv");
const clubs = loadCsv("fixtures/clubs.csv");

const inner = project(join(students, "id", clubs, "student_id", "inner"), ["name", "club", "role"]);
console.log(show(inner));
console.log();
const left = project(join(students, "id", clubs, "student_id", "left"), ["id", "name", "club"]);
console.log(
  `left join rows: ${left.rows.length}, without club: ${left.rows
    .filter((r) => r[2] === "")
    .map((r) => r[1])
    .join(", ")}`,
);
const anti = join(clubs, "student_id", students, "id", "anti");
console.log(`club rows with unknown students: ${anti.rows.map((r) => r.join("/")).join("; ")}`);

const byClub = new Map<string, string[]>();
for (const [name, club] of inner.rows) {
  if (!name || !club) continue;
  byClub.set(club, [...(byClub.get(club) ?? []), name.split(" ")[0] ?? name]);
}
for (const [club, names] of [...byClub].sort()) console.log(`${club}: ${names.sort().join(", ")}`);
writeFileSync(
  "memberships.csv",
  [inner.header.join(","), ...inner.rows.map((r) => r.join(","))].join("\n") + "\n",
);
