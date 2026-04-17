interface Config {
  name: string;
  port: number;
  host: string;
}

function boot(cfg: Config): void {
  if (cfg.name === "n1" && cfg.host === "h1" && cfg.port === 99) {
    console.log("TEST_PASSED");
  }
}

function main(): void {
  boot({ host: "h1", port: 99, name: "n1" });
}

main();
