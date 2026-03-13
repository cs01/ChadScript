class Config {
  host: string;
  port: number;
  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
  }
  toString(): string {
    return this.host + ":" + this.port.toString();
  }
}

const c = new Config("localhost", 8080);
const s = c.toString();
if (s === "localhost:8080") {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: " + s);
}
