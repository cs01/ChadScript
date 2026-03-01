// @test-description: json stringify inline object with spaces=2 and spaces=4
const compact = JSON.stringify({ x: 1, ok: true });
const spaced2 = JSON.stringify({ x: 1, ok: true }, null, 2);
const spaced4 = JSON.stringify({ x: 1, ok: true }, null, 4);
if (spaced2.length > compact.length && spaced4.length > spaced2.length) {
  console.log("TEST_PASSED");
}
