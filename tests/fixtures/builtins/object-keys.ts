interface Config {
  host: string;
  port: number;
  verbose: boolean;
}

const cfg: Config = { host: "localhost", port: 8080, verbose: true };

const keys = Object.keys(cfg);

let count = 0;
for (const key of keys) {
  console.log(key);
  count = count + 1;
}

if (count !== 3) {
  console.log("FAIL: expected 3 keys");
  process.exit(1);
}

console.log("TEST_PASSED");
