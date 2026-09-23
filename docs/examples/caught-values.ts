// A caught value is the value that was thrown: a thrown string stays a string.
function risky(n: number): void {
  if (n === 0) throw "zero is not allowed";
  if (n < 0) throw new RangeError(`negative: ${n}`);
}

for (const n of [0, -1, 1]) {
  try {
    risky(n);
    console.log(n, "ok");
  } catch (e) {
    if (typeof e === "string") {
      console.log(n, "string:", e.toUpperCase());
    } else if (e instanceof RangeError) {
      console.log(n, `${e.name}:`, e.message);
    }
    console.log(typeof e, e === "zero is not allowed", String(e));
  }
}
