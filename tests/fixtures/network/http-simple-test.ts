// Simplified HTTP handler test
interface HttpRequest {
  method: number;
  path: number;
  bodyLen: number;
}

function simpleHandler(method: number, path: number): number {
  if (method === 0) {
    if (path === 1) {
      return 200;
    }
    return 404;
  }
  return 405;
}

function testSimple(): number {
  console.log("Test 1");
  const result1 = simpleHandler(0, 1);
  console.log(result1);

  console.log("Test 2");
  const result2 = simpleHandler(0, 999);
  console.log(result2);

  console.log("Test 3");
  const result3 = simpleHandler(1, 1);
  console.log(result3);

  return 0;
}

testSimple();
