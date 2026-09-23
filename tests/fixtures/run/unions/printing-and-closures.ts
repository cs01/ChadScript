// console.log of Values holding every kind (top level and nested), Boolean(), switch (typeof x),
// and closures capturing a Value union const that tsc narrows inside the closure.
interface Pt {
  x: number;
  y: number;
}
type Any = number | string | boolean | null | undefined | Pt | number[] | ((n: number) => number);

function make(i: number): Any {
  switch (i) {
    case 0:
      return 1.5;
    case 1:
      return "str";
    case 2:
      return false;
    case 3:
      return null;
    case 4:
      return undefined;
    case 5:
      return { x: 1, y: 2 };
    case 6:
      return [1, 2, 3];
    default:
      return (n: number): number => n * 2;
  }
}

function kindOf(v: Any): string {
  switch (typeof v) {
    case "number":
      return `num(${v.toString()})`;
    case "string":
      return `str(${v.length})`;
    case "boolean":
      return v ? "yes" : "no";
    case "function":
      return `fn(${v(21)})`;
    case "undefined":
      return "undef";
    default:
      return v === null ? "null" : "object";
  }
}

for (let i = 0; i < 8; i++) {
  const v = make(i);
  console.log(v);
  console.log([v], { v }, typeof v, Boolean(v), !v, kindOf(v));
}

const captured: number | string = Math.max(1, 2) > 1 ? "cap" : 0;
const show = (): string => (typeof captured === "string" ? captured.toUpperCase() : "num");
console.log(show(), captured);
const nested: (string | number)[][] = [
  [1, "a"],
  ["b", 2],
];
console.log(nested, JSON.stringify(nested));
