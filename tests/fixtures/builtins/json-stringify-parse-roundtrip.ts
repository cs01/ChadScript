// @test-description: json stringify of a json parse result (llvm type tracking)

interface Config {
  host: string;
  port: number;
  debug: boolean;
}

const raw = '{"host":"localhost","port":8080,"debug":1}';
const cfg = JSON.parse<Config>(raw);
const out = JSON.stringify(cfg);
const cfg2 = JSON.parse<Config>(out);

if (cfg2.host === "localhost" && cfg2.port === 8080) {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: " + cfg2.host + " " + cfg2.port);
}
