// Standalone function accessing arr[0].type via a struct field
// Previously only worked in class methods due to missing parameter type resolution
interface Item {
  type: string;
  value: number;
}

interface Container {
  type: string;
  items: Item[];
}

function getFirstItemType(container: Container): string {
  const item = container.items[0];
  if (item.type === "number") {
    return "number";
  }
  return "unknown";
}

const c: Container = { type: "box", items: [{ type: "number", value: 42 }] };
const result = getFirstItemType(c);
if (result === "number") {
  console.log("TEST_PASSED");
} else {
  console.log("FAILED: got " + result);
}
