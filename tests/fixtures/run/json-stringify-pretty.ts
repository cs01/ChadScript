// JSON.stringify pretty-printing via the `space` argument: numeric indent (N spaces), string indent,
// nested containers, optional-field omission, and empty containers ([] / {} stay compact).
interface Nested {
  id: number;
  meta: { active: boolean; score: number };
  tags: string[];
  note?: string;
}
const n: Nested = { id: 1, meta: { active: true, score: 2.5 }, tags: ["x", "y"], note: "hi" };
const minimal: Nested = { id: 2, meta: { active: false, score: 0 }, tags: [] };
console.log(JSON.stringify(n, null, 2));
console.log(JSON.stringify(minimal, null, 2));
console.log(JSON.stringify(n, null, "\t"));
const list: Nested[] = [minimal];
console.log(JSON.stringify(list, null, 4));
const empty: number[] = [];
console.log(JSON.stringify(empty, null, 2));
// space 0 / omitted → compact
console.log(JSON.stringify(n, null, 0));
console.log(JSON.stringify(minimal));
