// @category: scripts
// A personal expense tracker script: a list of expenses, monthly totals per category, budget
// checks, and a split of shared costs between people. Saves a monthly summary file.
import { writeFileSync } from "node:fs";

interface Expense {
  month: string;
  category: string;
  amount: number;
  paidBy: string;
  shared: boolean;
}

const expenses: Expense[] = [
  { month: "2024-01", category: "rent", amount: 1500, paidBy: "sam", shared: true },
  { month: "2024-01", category: "groceries", amount: 320.45, paidBy: "alex", shared: true },
  { month: "2024-01", category: "fun", amount: 60, paidBy: "sam", shared: false },
  { month: "2024-01", category: "utilities", amount: 145.2, paidBy: "alex", shared: true },
  { month: "2024-02", category: "rent", amount: 1500, paidBy: "sam", shared: true },
  { month: "2024-02", category: "groceries", amount: 410.1, paidBy: "sam", shared: true },
  { month: "2024-02", category: "fun", amount: 220, paidBy: "alex", shared: false },
  { month: "2024-02", category: "groceries", amount: 35.5, paidBy: "alex", shared: true },
];

const budget: Record<string, number> = { rent: 1500, groceries: 400, fun: 150, utilities: 200 };

const months: string[] = [];
for (const e of expenses) {
  if (months.indexOf(e.month) === -1) months.push(e.month);
}

const summary: string[] = [];
for (const month of months) {
  const inMonth = expenses.filter((e) => e.month === month);
  const byCategory: Record<string, number> = {};
  for (const e of inMonth) {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  }
  summary.push(`== ${month} ==`);
  let total = 0;
  for (const category of Object.keys(byCategory).sort()) {
    const spent = byCategory[category] || 0;
    total += spent;
    const limit = budget[category];
    const flag =
      limit !== undefined && spent > limit ? ` OVER by ${(spent - limit).toFixed(2)}` : "";
    summary.push(`  ${category.padEnd(10)} ${spent.toFixed(2).padStart(9)}${flag}`);
  }
  summary.push(`  ${"total".padEnd(10)} ${total.toFixed(2).padStart(9)}`);

  const paid: Record<string, number> = {};
  let sharedTotal = 0;
  for (const e of inMonth) {
    if (!e.shared) continue;
    sharedTotal += e.amount;
    paid[e.paidBy] = (paid[e.paidBy] || 0) + e.amount;
  }
  const people = ["alex", "sam"];
  const fair = sharedTotal / people.length;
  for (const p of people) {
    const diff = (paid[p] || 0) - fair;
    summary.push(`  ${p} ${diff >= 0 ? "is owed" : "owes"} ${Math.abs(diff).toFixed(2)}`);
  }
}

console.log(summary.join("\n"));
writeFileSync("summary.txt", summary.join("\n") + "\n");
const biggest = expenses.reduce((a, b) => (b.amount > a.amount ? b : a));
console.log(`largest expense: ${biggest.category} ${biggest.amount} in ${biggest.month}`);
