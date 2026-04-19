interface Conf {
  name: string;
  port: number;
  host: string;
}

class Server {
  cfg: Conf;
  constructor() {
    this.cfg = { name: "boot", port: 1, host: "h0" };
  }
  reconfigure(): void {
    this.cfg = { port: 8080, host: "hh", name: "nn" };
  }
}

function main(): void {
  const s = new Server();
  s.reconfigure();
  if (s.cfg.name === "nn" && s.cfg.port === 8080 && s.cfg.host === "hh") {
    console.log("TEST_PASSED");
  }
}

main();
