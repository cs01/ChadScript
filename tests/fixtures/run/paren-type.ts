// Parentheses inside a TYPE: required to spell an array of functions. They have no runtime
// meaning — the checker resolves the type they group.
const doubles: ((n: number) => number)[] = [(n) => n * 2, (n) => n * 4];
for (const f of doubles) {
  console.log(f(3));
}
const nullable: ((n: number) => number) | null = null;
console.log(nullable === null ? "null fn" : "fn");
