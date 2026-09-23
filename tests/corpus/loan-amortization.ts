// @category: scripts
// @args: 250000 6.5 30
// A mortgage calculator: monthly payment, a yearly amortization summary, total interest, and the
// effect of an extra monthly payment. Writes the full monthly schedule as CSV.
import { writeFileSync } from "node:fs";

function monthlyPayment(principal: number, annualRatePct: number, years: number): number {
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

interface Month {
  n: number;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
}

function schedule(principal: number, ratePct: number, years: number, extra: number): Month[] {
  const r = ratePct / 100 / 12;
  const base = monthlyPayment(principal, ratePct, years);
  const months: Month[] = [];
  let balance = principal;
  let n = 0;
  while (balance > 0.005 && n < years * 12) {
    n++;
    const interest = balance * r;
    let pay = base + extra;
    if (pay > balance + interest) pay = balance + interest;
    const toPrincipal = pay - interest;
    balance -= toPrincipal;
    months.push({
      n,
      payment: pay,
      interest,
      principal: toPrincipal,
      balance: Math.max(balance, 0),
    });
  }
  return months;
}

function money(x: number): string {
  return "$" + x.toFixed(2);
}

const args = process.argv.slice(2);
const principal = Number(args[0] ?? 100000);
const rate = Number(args[1] ?? 5);
const years = Number(args[2] ?? 15);

const payment = monthlyPayment(principal, rate, years);
console.log(`loan ${money(principal)} at ${rate}% for ${years} years`);
console.log(`monthly payment: ${money(payment)}`);

const plain = schedule(principal, rate, years, 0);
console.log("year  interest     principal    balance");
for (let y = 1; y <= years; y += 5) {
  const slice = plain.slice((y - 1) * 12, y * 12);
  const interest = slice.reduce((s, m) => s + m.interest, 0);
  const princ = slice.reduce((s, m) => s + m.principal, 0);
  const end = slice[slice.length - 1];
  console.log(
    `${String(y).padStart(4)}  ${money(interest).padStart(11)}  ${money(princ).padStart(11)}  ${money(end ? end.balance : 0).padStart(12)}`,
  );
}
const totalInterest = plain.reduce((s, m) => s + m.interest, 0);
console.log(`total interest: ${money(totalInterest)}`);

const faster = schedule(principal, rate, years, 200);
const saved = totalInterest - faster.reduce((s, m) => s + m.interest, 0);
console.log(`with $200 extra/month: paid off in ${faster.length} months, saving ${money(saved)}`);

const csv = ["month,payment,interest,principal,balance"];
for (const m of plain) {
  csv.push(
    [
      m.n,
      m.payment.toFixed(2),
      m.interest.toFixed(2),
      m.principal.toFixed(2),
      m.balance.toFixed(2),
    ].join(","),
  );
}
writeFileSync("schedule.csv", csv.join("\n") + "\n");
console.log(`wrote ${plain.length} rows to schedule.csv`);
