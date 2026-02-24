// Tests that bare method references on interface-typed objects are truthy
// when the implementing class provides the method. This is the pattern:
//   if (obj.method) { obj.method() }
// which JavaScript evaluates as truthy for any existing method.
// @test-description: interface method truthiness check

interface Formatter {
  format(value: string): string;
}

class UpperFormatter {
  format(value: string): string {
    return value;
  }
}

const f: Formatter = new UpperFormatter();

// Bare method reference should be truthy
const result = f.format ? "exists" : "missing";
if (result === "exists") {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: method truthiness returned false");
}
