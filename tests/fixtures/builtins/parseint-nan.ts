function test(): void {
  const a = parseInt("42");
  if (a !== 42) {
    console.log("FAIL basic: " + a.toString());
    return;
  }

  const b = parseInt("-7");
  if (b !== -7) {
    console.log("FAIL negative: " + b.toString());
    return;
  }

  const c = parseInt("abc");
  if (!isNaN(c)) {
    console.log("FAIL NaN for abc: " + c.toString());
    return;
  }

  const d = parseInt("");
  if (!isNaN(d)) {
    console.log("FAIL NaN for empty: " + d.toString());
    return;
  }

  const e = parseInt("0");
  if (e !== 0) {
    console.log("FAIL zero: " + e.toString());
    return;
  }

  const f = parseFloat("3.14");
  if (f !== 3.14) {
    console.log("FAIL parseFloat basic");
    return;
  }

  const g = parseFloat("xyz");
  if (!isNaN(g)) {
    console.log("FAIL parseFloat NaN: " + g.toString());
    return;
  }

  console.log("TEST_PASSED");
}
test();
