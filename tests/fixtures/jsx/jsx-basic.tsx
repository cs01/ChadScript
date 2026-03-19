// @test-native-only
// Basic JSX element desugars to createElement call
interface EmptyProps {}

function createElement(tag: string, props: EmptyProps, children: string[]): string {
  return tag + ":" + children.length.toString();
}

const result = <Box>hello</Box>;
if (result === "Box:1") {
  console.log("TEST_PASSED");
}
