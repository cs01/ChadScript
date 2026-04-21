// @test-description: string | null accepts null literal and string values
const a: string | null = null;
const b: string | null = "hello";

if (a === null) {
  if (b !== null) {
    console.log("TEST_PASSED");
  }
}
