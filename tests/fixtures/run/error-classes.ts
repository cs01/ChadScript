// The builtin error classes: construct, throw, catch, narrow with instanceof, read message/name.
function parse(s: string): number {
  const n = Number(s);
  if (Number.isNaN(n)) throw new TypeError("not a number: " + s);
  if (n < 0) throw new RangeError("negative: " + s);
  return n;
}
for (const s of ["4", "x", "-1"]) {
  try {
    console.log(parse(s));
  } catch (e) {
    if (e instanceof TypeError) console.log("type", e.name, e.message);
    else if (e instanceof RangeError) console.log("range", e.name, e.message, e instanceof Error);
    else console.log("other", String(e));
  }
}

const err = new Error("built");
console.log(err.message, err.name, String(err), `${err}`, "err=" + err);
const empty = new Error();
console.log(String(empty), JSON.stringify(empty.message), empty.message.length);

function fail(e: Error): void {
  throw e;
}
try {
  fail(new SyntaxError("syn"));
} catch (e) {
  console.log(e instanceof SyntaxError, e instanceof TypeError, e instanceof Error, String(e));
}

try {
  throw "plain";
} catch (e) {
  console.log(e instanceof Error ? e.name + ": " + e.message : "thrown " + String(e));
}
try {
  throw new RangeError("r");
} catch (e) {
  console.log(e instanceof Error ? e.name + ": " + e.message : "thrown " + String(e));
}

const errs: Error[] = [new TypeError("a"), new Error("b")];
for (const x of errs) console.log(x.message, x instanceof TypeError);
const makeErr = (m: string): Error => new RangeError(m);
console.log(makeErr("made").name);

try {
  const v: number = JSON.parse("{bad");
  console.log(v);
} catch (e) {
  console.log("parse failed:", e instanceof SyntaxError, e instanceof Error);
}

// Without `new`, the error classes construct just the same.
const called = TypeError("called");
console.log(called.name, called.message, called instanceof TypeError);
// An error is one record: identity, and kept in fields, optionals and maps.
const same = err;
console.log(same === err, err === empty);
interface Result {
  error: Error | null;
  value: number;
}
const results: Result[] = [
  { error: null, value: 1 },
  { error: new RangeError("too big"), value: 0 },
];
for (const r of results) {
  if (r.error !== null) console.log("failed:", r.error.message, r.error instanceof RangeError);
  else console.log("ok:", r.value);
}
const byName = new Map<string, Error>();
byName.set("a", new SyntaxError("in map"));
const got = byName.get("a");
if (got) console.log(got.name, got.message);
