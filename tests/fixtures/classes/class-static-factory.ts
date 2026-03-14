class Config {
  host: string;
  port: number;
  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
  }
  static createDefault(): Config {
    return new Config("localhost", 8080);
  }
  describe(): string {
    return this.host + ":" + this.port.toString();
  }
}

const cfg = Config.createDefault();
let pass = true;
if (cfg.host !== "localhost") {
  console.log("FAIL host");
  pass = false;
}
if (cfg.port !== 8080) {
  console.log("FAIL port");
  pass = false;
}
if (cfg.describe() !== "localhost:8080") {
  console.log("FAIL describe: " + cfg.describe());
  pass = false;
}
if (pass) console.log("TEST_PASSED");
