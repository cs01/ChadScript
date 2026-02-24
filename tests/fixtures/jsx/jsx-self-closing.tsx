// Self-closing JSX element produces empty children array
interface EmptyProps {}

function createElement(tag: string, props: EmptyProps, children: string[]): string {
  return tag + ":" + children.length.toString();
}

const result = <Input />;
if (result === "Input:0") {
  console.log("TEST_PASSED");
}
