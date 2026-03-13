const t = String(true);
if (t !== "true") {
  process.exit(1);
}

const f = String(false);
if (f !== "false") {
  process.exit(1);
}

const x = true;
const xs = String(x);
if (xs !== "true") {
  process.exit(1);
}

const y = false;
const ys = String(y);
if (ys !== "false") {
  process.exit(1);
}

const n = String(42);
if (n !== "42") {
  process.exit(1);
}

const s = String("hello");
if (s !== "hello") {
  process.exit(1);
}

console.log("TEST_PASSED");
