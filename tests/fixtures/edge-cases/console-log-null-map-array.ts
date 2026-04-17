// @test-description: console.log on Map.get() miss for array value prints undefined instead of segfaulting
const m = new Map<string, number[]>();
const v = m.get("nope");
console.log(v);
console.log("TEST_PASSED");
