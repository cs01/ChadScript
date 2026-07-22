function pick(n: number): string | null | undefined {
  if (n === 0) {
    return null;
  }
  if (n === 1) {
    return undefined;
  }
  return "value";
}
console.log(pick(0));
console.log(pick(1));
console.log(pick(2));
console.log(pick(0) === null);
console.log(pick(0) === undefined);
console.log(pick(1) === undefined);
console.log(pick(0) ?? "fallback");
console.log(pick(1) ?? "fallback");
console.log(pick(2) ?? "fallback");
