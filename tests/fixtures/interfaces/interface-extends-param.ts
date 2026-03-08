interface Base {
  id: number;
  name: string;
}

interface Extended extends Base {
  value: string;
}

function printBase(obj: Base): string {
  return obj.name;
}

function printExtended(obj: Extended): string {
  return obj.name + ":" + obj.value;
}

const e: Extended = { id: 1, name: "test", value: "hello" };

const n = printBase(e);
const r = printExtended(e);

if (n === "test" && r === "test:hello") {
  console.log("TEST_PASSED");
}
