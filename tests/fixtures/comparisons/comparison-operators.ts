function testComparisons(): void {
  if (!(5 > 3)) { console.log("FAIL: 5 > 3"); process.exit(1); }
  if (!(3 < 5)) { console.log("FAIL: 3 < 5"); process.exit(1); }
  if (!(5 >= 5)) { console.log("FAIL: 5 >= 5"); process.exit(1); }
  if (!(5 <= 5)) { console.log("FAIL: 5 <= 5"); process.exit(1); }
  if (5 > 5) { console.log("FAIL: 5 > 5 should be false"); process.exit(1); }
  if (5 < 5) { console.log("FAIL: 5 < 5 should be false"); process.exit(1); }

  if (!(10 !== 20)) { console.log("FAIL: 10 !== 20"); process.exit(1); }
  if (10 !== 10) { console.log("FAIL: 10 === 10"); process.exit(1); }

  const a: string = "abc";
  const b: string = "abc";
  const c: string = "xyz";
  if (a !== b) { console.log("FAIL: string equality"); process.exit(1); }
  if (a === c) { console.log("FAIL: string inequality"); process.exit(1); }

  console.log("TEST_PASSED");
}

testComparisons();
