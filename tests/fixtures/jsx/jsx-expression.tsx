// @test-native-only
// Expression children are evaluated as expressions
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

const name = "world";
const result = <Text>hello {name}</Text>;
if (result === "Text(hello)(world)") {
  console.log("TEST_PASSED");
}
