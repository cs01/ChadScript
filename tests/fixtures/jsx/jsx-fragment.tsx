// @test-native-only
// Fragments desugar to createElement("Fragment", {}, [...])
interface EmptyProps {}

function createElement(tag: string, props: EmptyProps, children: string[]): string {
  let result = tag;
  let i = 0;
  while (i < children.length) {
    result = result + "(" + children[i] + ")";
    i = i + 1;
  }
  return result;
}

const result = <>hello world</>;
if (result === "Fragment(hello world)") {
  console.log("TEST_PASSED");
}
