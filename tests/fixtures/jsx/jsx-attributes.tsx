// @test-native-only
// JSX attributes become object properties, boolean shorthand works
interface BoxProps {
  border: string;
  disabled: boolean;
}

function createElement(tag: string, props: BoxProps, children: string[]): string {
  let result = tag;
  if (props.border === "single") {
    result = result + ":border";
  }
  if (props.disabled === true) {
    result = result + ":disabled";
  }
  return result;
}

const result = <Box border="single" disabled />;
if (result === "Box:border:disabled") {
  console.log("TEST_PASSED");
}
