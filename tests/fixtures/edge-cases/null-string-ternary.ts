function divide(a: number, b: number): string {
  if (b === 0) return "error: division by zero";
  return (a / b).toString();
}

if (divide(10, 2) !== "5") process.exit(1);
if (divide(10, 0) !== "error: division by zero") process.exit(1);
const r = divide(7, 3);
if (!r.startsWith("2.333333")) process.exit(1);

const x: string | null = null;
const y: string | null = "hello";
if (x !== null) process.exit(1);
if (y === null) process.exit(1);
if (y !== "hello") process.exit(1);

const z = y === null ? "null" : y;
if (z !== "hello") process.exit(1);

console.log("TEST_PASSED");
