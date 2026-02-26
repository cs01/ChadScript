// @test-skip
// Regression test: using JSON.parse<T>() and response.json<T>() with the same
// interface in the same file previously caused a duplicate parse_json_T
// function definition in the generated LLVM IR.

interface Item {
  id: number;
  name: string;
}

async function runTests(): Promise<void> {
  const fromParse = JSON.parse<Item>('{"id":1,"name":"parsed"}');
  if (fromParse.id !== 1) {
    console.log("FAIL: JSON.parse id");
    process.exit(1);
  }
  if (fromParse.name !== "parsed") {
    console.log("FAIL: JSON.parse name");
    process.exit(1);
  }

  const response = await fetch("http://127.0.0.1:19882/item");
  const fromJson = response.json<Item>();
  if (fromJson.id !== 2) {
    console.log("FAIL: response.json id");
    process.exit(1);
  }
  if (fromJson.name !== "fetched") {
    console.log("FAIL: response.json name");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

runTests();
