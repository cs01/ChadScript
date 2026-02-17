function getOrDefault(value: string, fallback: string): string {
  return value ?? fallback;
}

console.log(getOrDefault("hello", "world"));

const a: number = 0;
const b = a ?? 42;
console.log(b.toFixed(0));

const s = "" ?? "default";
console.log(s.length.toFixed(0));

const t: string = "present";
const u = t ?? "absent";
console.log(u);

console.log("TEST_PASSED");
