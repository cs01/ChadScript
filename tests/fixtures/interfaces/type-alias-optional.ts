type Config = {
  host: string;
  port?: number;
};

const cfg: Config = { host: "localhost" };
if (cfg.host === "localhost") {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL");
}
