class Config {
  name: string;
  debug: boolean;
  timeout: number;
  constructor(name: string) {
    this.name = name;
    this.debug = false;
    this.timeout = 30;
  }
}

function main(): void {
  const cfg = new Config("app");
  cfg.debug = true;
  cfg.timeout = 60;

  if (cfg.name === "app" && cfg.debug === true && cfg.timeout === 60) {
    console.log("TEST_PASSED");
  }
}

main();
