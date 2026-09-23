// @category: parsing
// Converts a CSV of students into typed JSON records (numbers, booleans, missing values as null),
// computes per-grade averages, and writes students.json and grades.csv.
import { readFileSync, writeFileSync } from "node:fs";

interface Student {
  id: number;
  name: string;
  grade: number;
  scores: { math: number | null; science: number | null; english: number | null };
  active: boolean;
}

function toNumber(s: string | undefined): number | null {
  if (s === undefined || s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parse(text: string): Student[] {
  const [headerLine, ...lines] = text.trim().split("\n");
  const header = headerLine!.split(",");
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`missing column ${name}`);
    return i;
  };
  return lines.map((line) => {
    const f = line.split(",");
    return {
      id: toNumber(f[col("id")]) ?? 0,
      name: f[col("name")] ?? "",
      grade: toNumber(f[col("grade")]) ?? 0,
      scores: {
        math: toNumber(f[col("math")]),
        science: toNumber(f[col("science")]),
        english: toNumber(f[col("english")]),
      },
      active: f[col("active")] === "true",
    };
  });
}

function mean(xs: (number | null)[]): number | null {
  const present = xs.filter((x): x is number => x !== null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

const students = parse(readFileSync("fixtures/students.csv", "utf8"));
writeFileSync("students.json", JSON.stringify(students, null, 2));

const grades = [...new Set(students.map((s) => s.grade))].sort((a, b) => a - b);
const rows = ["grade,count,math,science,english"];
for (const g of grades) {
  const group = students.filter((s) => s.grade === g);
  const avg = (k: keyof Student["scores"]): string =>
    mean(group.map((s) => s.scores[k]))?.toFixed(1) ?? "n/a";
  rows.push(`${g},${group.length},${avg("math")},${avg("science")},${avg("english")}`);
}
writeFileSync("grades.csv", rows.join("\n") + "\n");
console.log(rows.join("\n"));

const ranked = students
  .map((s) => ({ name: s.name, avg: mean(Object.values(s.scores)) ?? 0 }))
  .sort((a, b) => b.avg - a.avg);
ranked.forEach((r, i) => console.log(`${i + 1}. ${r.name} ${r.avg.toFixed(2)}`));
console.log(
  "inactive:",
  students
    .filter((s) => !s.active)
    .map((s) => s.name)
    .join("; "),
);
console.log(
  "missing scores:",
  students.filter((s) => Object.values(s.scores).includes(null)).length,
);
