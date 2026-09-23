// @category: scripts
// @known-bug: the global `isNaN(x)` is accepted but lowers to a call of an undefined `@isNaN` function, so clang rejects the IR
// A temperature conversion script: a Celsius/Fahrenheit/Kelvin table, parsing temperatures with
// units from strings, and classifying readings.

type Unit = "C" | "F" | "K";

function toCelsius(value: number, unit: Unit): number {
  switch (unit) {
    case "C":
      return value;
    case "F":
      return ((value - 32) * 5) / 9;
    case "K":
      return value - 273.15;
  }
}

function fromCelsius(c: number, unit: Unit): number {
  switch (unit) {
    case "C":
      return c;
    case "F":
      return (c * 9) / 5 + 32;
    case "K":
      return c + 273.15;
  }
}

function round(n: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

function parseReading(s: string): { value: number; unit: Unit } | null {
  const trimmed = s.trim().toUpperCase();
  const unit = trimmed.charAt(trimmed.length - 1);
  if (unit !== "C" && unit !== "F" && unit !== "K") return null;
  const value = parseFloat(trimmed.slice(0, -1));
  if (isNaN(value)) return null;
  return { value, unit };
}

function classify(c: number): string {
  if (c <= 0) return "freezing";
  if (c < 10) return "cold";
  if (c < 20) return "mild";
  if (c < 30) return "warm";
  return "hot";
}

console.log("   C       F       K");
for (let c = -40; c <= 100; c += 20) {
  const f = fromCelsius(c, "F");
  const k = fromCelsius(c, "K");
  console.log(
    String(c).padStart(4) + String(round(f, 1)).padStart(8) + String(round(k, 2)).padStart(8),
  );
}

const readings = ["21.5C", "70F", "300k", "-5 c", "abc", "98.6F", "0K", "12X"];
let valid = 0;
let total = 0;
for (const r of readings) {
  const parsed = parseReading(r);
  if (parsed === null) {
    console.log(`${r}: unparseable`);
    continue;
  }
  const c = toCelsius(parsed.value, parsed.unit);
  valid++;
  total += c;
  console.log(`${r}: ${round(c, 2)} C (${classify(c)})`);
}
console.log(`average of ${valid} readings: ${round(total / valid, 3)} C`);
console.log(`round trip 37C -> F -> C: ${toCelsius(fromCelsius(37, "F"), "F")}`);
