// Nested JSX elements produce nested createElement calls
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

const result = (
  <Box>
    <Text>hello</Text>
  </Box>
);
if (result === "Box(Text(hello))") {
  console.log("TEST_PASSED");
}
