// Test JSON.stringify on a typed JSON.parse result
interface JsonObj {
  name: string;
  version: number;
}

const obj = JSON.parse<JsonObj>('{"name":"chad","version":1}');
const back = JSON.stringify(obj);
if (back.includes("chad")) {
  console.log("TEST_PASSED");
}
