// The four built-in error classes: construct, throw, catch, test with instanceof, and read
// .message and .name. String(e) is "Name: message", as in Node.
function check(input: string): number {
  if (input === "") throw new SyntaxError("empty input");
  const n = Number(input);
  if (Number.isNaN(n)) throw new TypeError(`not a number: ${input}`);
  if (n < 0 || n > 100) throw new RangeError(`out of range: ${n}`);
  if (n === 13) throw new Error("unlucky");
  return n;
}

for (const input of ["42", "", "abc", "200", "13"]) {
  try {
    console.log("ok", check(input));
  } catch (e) {
    if (e instanceof RangeError) {
      console.log("range problem:", e.message);
    } else if (e instanceof TypeError || e instanceof SyntaxError) {
      console.log(e.name, "->", e.message);
    } else {
      console.log(String(e), e instanceof Error);
    }
  }
}

// A thrown string is caught as that string.
try {
  throw "plain text";
} catch (e) {
  console.log(String(e));
}
