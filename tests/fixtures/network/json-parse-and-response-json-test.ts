// @test-skip

interface Item {
  id: number;
  name: string;
}

function getPort(): string {
  const args = process.argv;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-p") {
      return args[i + 1];
    }
  }
  return "19882";
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

  const port = getPort();
  const response = await fetch("http://127.0.0.1:" + port + "/item");
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
