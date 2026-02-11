interface Config {
  host: string;
  port: number;
}

function testObjectDestructureRename(): void {
  const config: Config = { host: "localhost", port: 8080 };
  const { host: h, port: p } = config;

  if (h !== "localhost") {
    console.log("FAIL: h should be localhost");
    process.exit(1);
  }

  if (p !== 8080) {
    console.log("FAIL: p should be 8080");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testObjectDestructureRename();
