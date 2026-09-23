// @category: scripts
// @args: 2024 2
// Prints a month calendar like `cal` without Date: leap years, days per month, Zeller's
// congruence for the weekday, and the ISO day-of-year for a few dates.

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysIn(year: number, month: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

// 0 = Sunday ... 6 = Saturday
function weekday(year: number, month: number, day: number): number {
  let m = month;
  let y = year;
  if (m < 3) {
    m += 12;
    y -= 1;
  }
  const k = y % 100;
  const j = Math.floor(y / 100);
  const h =
    (day + Math.floor((13 * (m + 1)) / 5) + k + Math.floor(k / 4) + Math.floor(j / 4) + 5 * j) % 7;
  return (h + 6) % 7;
}

function dayOfYear(year: number, month: number, day: number): number {
  let n = day;
  for (let m = 1; m < month; m++) n += daysIn(year, m);
  return n;
}

function render(year: number, month: number): string {
  const title = `${MONTHS[month - 1]} ${year}`;
  const lines = [title.padStart(Math.floor((20 + title.length) / 2)), "Su Mo Tu We Th Fr Sa"];
  let line = "   ".repeat(weekday(year, month, 1));
  for (let d = 1; d <= daysIn(year, month); d++) {
    line += String(d).padStart(2) + " ";
    if (weekday(year, month, d) === 6) {
      lines.push(line.trimEnd());
      line = "";
    }
  }
  if (line) lines.push(line.trimEnd());
  return lines.join("\n");
}

const [yArg, mArg] = process.argv.slice(2);
const year = Number(yArg ?? "2000");
const month = Number(mArg ?? "1");
if (!(month >= 1 && month <= 12)) {
  console.log(`cal: ${mArg} is neither a month number (1..12) nor a name`);
  process.exit(64);
}
console.log(render(year, month));
console.log();
console.log(render(1970, 1));
const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
for (const [y, m, d] of [
  [1969, 7, 20],
  [2000, 1, 1],
  [2024, 12, 31],
  [2100, 3, 1],
]) {
  console.log(
    `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}: ${names[weekday(y!, m!, d!)]}, day ${dayOfYear(y!, m!, d!)}`,
  );
}
console.log([1900, 2000, 2023, 2024].map((y) => `${y}:${isLeap(y) ? "leap" : "common"}`).join(" "));
