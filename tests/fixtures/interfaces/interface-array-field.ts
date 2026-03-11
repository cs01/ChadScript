interface Config {
  name: string;
  tags: string[];
}

function getTags(cfg: Config): string[] {
  return cfg.tags;
}

function testInterfaceArrayField(): void {
  const cfg: Config = { name: "test", tags: ["alpha", "beta", "gamma"] };

  if (cfg.name !== "test") {
    console.log("FAIL: name should be test");
    process.exit(1);
  }

  const tags: string[] = getTags(cfg);
  if (tags.length !== 3) {
    console.log("FAIL: tags length should be 3, got " + tags.length);
    process.exit(1);
  }

  if (tags[0] !== "alpha") {
    console.log("FAIL: tags[0] should be alpha, got " + tags[0]);
    process.exit(1);
  }

  if (tags[2] !== "gamma") {
    console.log("FAIL: tags[2] should be gamma, got " + tags[2]);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testInterfaceArrayField();
