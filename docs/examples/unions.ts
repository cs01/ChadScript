// Unions of different kinds narrowed by typeof, Array.isArray and ===; a discriminated union
// narrowed by switch.
function describe(v: number | string | boolean[] | null): string {
  if (v === null) return "nothing";
  if (typeof v === "number") return `number ${v * 2}`;
  if (typeof v === "string") return `string ${v.toUpperCase()}`;
  return `flags ${v.filter((b: boolean): boolean => b).length}/${v.length}`;
}

console.log(describe(21), describe("hi"), describe([true, false, true]), describe(null));

type Event =
  | { kind: "click"; x: number; y: number }
  | { kind: "key"; code: string }
  | { kind: "quit" };

function handle(e: Event): string {
  switch (e.kind) {
    case "click":
      return `click at ${e.x},${e.y}`;
    case "key":
      return `key ${e.code}`;
    case "quit":
      return "bye";
  }
}

const events: Event[] = [
  { kind: "click", x: 3, y: 4 },
  { kind: "key", code: "Enter" },
  { kind: "quit" },
];
for (const e of events) console.log(handle(e));

// An un-narrowed union can still be printed, compared, and defaulted.
const maybe: string | number | undefined = events.length > 2 ? 42 : undefined;
console.log(maybe ?? "none", maybe === 42);
