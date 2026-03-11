function test(): void {
  let x = 10;
  x += 5;
  if (x !== 15) { console.log("FAIL +="); return; }
  x -= 3;
  if (x !== 12) { console.log("FAIL -="); return; }
  x *= 2;
  if (x !== 24) { console.log("FAIL *="); return; }
  x /= 4;
  if (x !== 6) { console.log("FAIL /="); return; }
  x %= 4;
  if (x !== 2) { console.log("FAIL %="); return; }

  let y = 15;
  y &= 6;
  if (y !== 6) { console.log("FAIL &="); return; }
  y |= 8;
  if (y !== 14) { console.log("FAIL |="); return; }
  y ^= 3;
  if (y !== 13) { console.log("FAIL ^="); return; }
  y <<= 2;
  if (y !== 52) { console.log("FAIL <<="); return; }
  y >>= 1;
  if (y !== 26) { console.log("FAIL >>="); return; }

  let s = "hello";
  s += " world";
  if (s !== "hello world") { console.log("FAIL str+="); return; }

  console.log("TEST_PASSED");
}
test();
