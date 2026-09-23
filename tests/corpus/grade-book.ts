// @category: scripts
// A grade book: weighted averages over assignments, letter grades, class statistics (mean,
// median, standard deviation), and a ranked report.

interface Student {
  name: string;
  homework: number[];
  midterm: number;
  final: number;
}

const WEIGHTS = { homework: 0.3, midterm: 0.3, final: 0.4 };

const students: Student[] = [
  { name: "Avery", homework: [90, 85, 100, 95], midterm: 88, final: 92 },
  { name: "Blake", homework: [70, 60, 80, 75], midterm: 65, final: 71 },
  { name: "Casey", homework: [100, 100, 95, 100], midterm: 97, final: 99 },
  { name: "Devon", homework: [50, 0, 65, 70], midterm: 58, final: 62 },
  { name: "Emery", homework: [85, 90, 88, 92], midterm: 79, final: 84 },
  { name: "Finley", homework: [95, 80, 0, 90], midterm: 91, final: 78 },
];

function average(xs: number[]): number {
  let sum = 0;
  for (const x of xs) sum += x;
  return xs.length === 0 ? 0 : sum / xs.length;
}

function dropLowest(xs: number[]): number[] {
  if (xs.length <= 1) return xs;
  const copy = xs.slice();
  copy.sort((a, b) => a - b);
  copy.shift();
  return copy;
}

function letter(score: number): string {
  if (score >= 93) return "A";
  if (score >= 90) return "A-";
  if (score >= 87) return "B+";
  if (score >= 83) return "B";
  if (score >= 80) return "B-";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

function stddev(xs: number[]): number {
  const m = average(xs);
  return Math.sqrt(average(xs.map((x) => (x - m) * (x - m))));
}

const results = students.map((s) => {
  const hw = average(dropLowest(s.homework));
  const total = hw * WEIGHTS.homework + s.midterm * WEIGHTS.midterm + s.final * WEIGHTS.final;
  return { name: s.name, hw, total, grade: letter(total) };
});

results.sort((a, b) => b.total - a.total);
console.log("Rank Name    HW     Total  Grade");
results.forEach((r, i) => {
  console.log(
    `${i + 1}.   ${r.name.padEnd(7)} ${r.hw.toFixed(1).padStart(5)}  ${r.total.toFixed(2).padStart(6)}  ${r.grade}`,
  );
});

const totals = results.map((r) => r.total);
console.log(
  `mean ${average(totals).toFixed(2)}, median ${median(totals).toFixed(2)}, stddev ${stddev(totals).toFixed(2)}`,
);
const distribution = new Map<string, number>();
for (const r of results) {
  const g = r.grade.charAt(0);
  distribution.set(g, (distribution.get(g) ?? 0) + 1);
}
console.log([...distribution.entries()].map(([g, n]) => `${g}:${n}`).join(" "));
console.log(
  "passing:",
  results
    .filter((r) => r.total >= 60)
    .map((r) => r.name)
    .join(", "),
);
