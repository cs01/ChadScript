// @category: algorithms
// Interval problems from scheduling code: merging overlaps, minimum meeting rooms, free slots in
// a working day, and inserting an interval into a sorted list. Times are minutes since midnight.

interface Interval {
  start: number;
  end: number;
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function parse(range: string): Interval {
  const [a, b] = range.split("-");
  const toMin = (s: string | undefined): number => {
    const [h, m] = (s ?? "0:0").split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  return { start: toMin(a), end: toMin(b) };
}

const show = (xs: Interval[]): string => xs.map((i) => `${hhmm(i.start)}-${hhmm(i.end)}`).join(" ");

function merge(xs: Interval[]): Interval[] {
  const sorted = [...xs].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else out.push({ ...cur });
  }
  return out;
}

function roomsNeeded(xs: Interval[]): number {
  const events: [number, number][] = [];
  for (const i of xs) events.push([i.start, 1], [i.end, -1]);
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let best = 0;
  for (const [, delta] of events) {
    cur += delta;
    best = Math.max(best, cur);
  }
  return best;
}

function freeSlots(busy: Interval[], day: Interval, minLength: number): Interval[] {
  const out: Interval[] = [];
  let cursor = day.start;
  for (const b of merge(busy)) {
    if (b.start - cursor >= minLength) out.push({ start: cursor, end: Math.min(b.start, day.end) });
    cursor = Math.max(cursor, b.end);
  }
  if (day.end - cursor >= minLength) out.push({ start: cursor, end: day.end });
  return out;
}

function insert(sorted: Interval[], x: Interval): Interval[] {
  const before = sorted.filter((i) => i.end < x.start);
  const after = sorted.filter((i) => i.start > x.end);
  const overlapping = sorted.filter((i) => i.end >= x.start && i.start <= x.end);
  const merged = overlapping.reduce(
    (acc, i) => ({ start: Math.min(acc.start, i.start), end: Math.max(acc.end, i.end) }),
    x,
  );
  return [...before, merged, ...after];
}

const meetings = [
  "09:00-10:30",
  "10:00-11:00",
  "13:00-14:00",
  "13:30-15:00",
  "16:00-16:30",
  "09:15-09:45",
].map(parse);
console.log("merged:", show(merge(meetings)));
console.log("rooms needed:", roomsNeeded(meetings));
console.log("free (>=30min):", show(freeSlots(meetings, parse("08:30-18:00"), 30)));
console.log("free (>=90min):", show(freeSlots(meetings, parse("08:30-18:00"), 90)));
console.log("insert:", show(insert(merge(meetings), parse("11:30-13:15"))));
console.log("insert:", show(insert(merge(meetings), parse("17:00-17:30"))));
