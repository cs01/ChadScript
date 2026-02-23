// Test JSON.stringify on untyped JSON.parse result (opaque yyjson value)
const obj = JSON.parse('{"name":"chad","version":1}');
const back = JSON.stringify(obj);
if (back.includes("chad")) {
  console.log("TEST_PASSED");
}
