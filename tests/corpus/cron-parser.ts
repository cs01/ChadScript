// @category: parsing
// Parses 5-field cron expressions (lists, ranges, steps, names, *), explains them, and computes
// the next few matching times from a fixed start using minute arithmetic (no Date).

interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
}

const FIELDS: { name: keyof CronSpec; min: number; max: number; names?: string[] }[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "dom", min: 1, max: 31 },
  {
    name: "month",
    min: 1,
    max: 12,
    names: ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"],
  },
  { name: "dow", min: 0, max: 6, names: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] },
];

function parseField(expr: string, min: number, max: number, names?: string[]): Set<number> {
  const out = new Set<number>();
  const value = (s: string): number => {
    const idx = names ? names.indexOf(s.toLowerCase()) : -1;
    const n = idx >= 0 ? idx + min : Number(s);
    if (!Number.isInteger(n) || n < min || n > max)
      throw new Error(`value ${s} out of range ${min}-${max}`);
    return n;
  };
  for (const part of expr.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!(step > 0)) throw new Error(`bad step in ${part}`);
    let lo = min;
    let hi = max;
    if (rangePart !== "*" && rangePart !== undefined) {
      const [a, b] = rangePart.split("-");
      lo = value(a ?? "");
      hi = b === undefined ? (stepPart === undefined ? lo : max) : value(b);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

function parseCron(expr: string): CronSpec {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`expected 5 fields, got ${parts.length}`);
  const spec = {} as CronSpec;
  FIELDS.forEach((f, i) => {
    spec[f.name] = parseField(parts[i]!, f.min, f.max, f.names);
  });
  return spec;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Walks forward minute by minute through a non-leap year starting Monday Jan 1, 00:00.
function nextRuns(spec: CronSpec, count: number): string[] {
  const out: string[] = [];
  let month = 1;
  let day = 1;
  let dow = 1;
  for (let minuteOfYear = 0; minuteOfYear < 365 * 1440 && out.length < count; minuteOfYear++) {
    const minute = minuteOfYear % 60;
    const hour = Math.floor(minuteOfYear / 60) % 24;
    if (minuteOfYear > 0 && minute === 0 && hour === 0) {
      dow = (dow + 1) % 7;
      day++;
      if (day > MONTH_DAYS[month - 1]!) {
        day = 1;
        month++;
      }
    }
    if (
      spec.minute.has(minute) &&
      spec.hour.has(hour) &&
      spec.month.has(month) &&
      spec.dom.has(day) &&
      spec.dow.has(dow)
    ) {
      out.push(
        `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      );
    }
  }
  return out;
}

const examples = [
  "*/15 9-10 * * mon-fri",
  "0 0 1 */3 *",
  "30 6 * jan,jul sun",
  "5,35 12 10-12 * *",
  "0 25 * * *",
  "* * *",
];
for (const e of examples) {
  try {
    const spec = parseCron(e);
    const sizes = FIELDS.map((f) => `${f.name}:${spec[f.name].size}`).join(" ");
    console.log(`${e.padEnd(24)} ${sizes}`);
    console.log(`  next: ${nextRuns(spec, 4).join(", ")}`);
  } catch (err) {
    console.log(`${e.padEnd(24)} error: ${(err as Error).message}`);
  }
}
