if (!isNaN(Math.sqrt(-1))) throw new Error("sqrt(-1) should be NaN");
if (!isNaN(0 / 0)) throw new Error("0/0 should be NaN");
if (!isNaN(Infinity - Infinity)) throw new Error("Inf-Inf should be NaN");

if (Math.abs(-0) !== 0) throw new Error("abs(-0)");
if (Math.abs(Infinity) !== Infinity) throw new Error("abs(Inf)");
if (!isNaN(Math.abs(NaN))) throw new Error("abs(NaN)");

if (Math.max(1, NaN) === Math.max(1, NaN)) {
  if (!isNaN(Math.max(1, NaN))) throw new Error("max with NaN");
}

if (Math.min(1, NaN) === Math.min(1, NaN)) {
  if (!isNaN(Math.min(1, NaN))) throw new Error("min with NaN");
}

if (Math.floor(Infinity) !== Infinity) throw new Error("floor(Inf)");
if (Math.ceil(-Infinity) !== -Infinity) throw new Error("ceil(-Inf)");
if (!isNaN(Math.floor(NaN))) throw new Error("floor(NaN)");

if (Math.round(0.5) !== 1) throw new Error("round 0.5");
if (Math.round(2.5) !== 3) throw new Error("round 2.5");

if (!isNaN(Math.log(-1))) throw new Error("log(-1)");
if (Math.log(0) !== -Infinity) throw new Error("log(0)");

if (Math.pow(0, 0) !== 1) throw new Error("0^0");
if (Math.pow(0, -1) !== Infinity) throw new Error("0^-1");

console.log("TEST_PASSED");
