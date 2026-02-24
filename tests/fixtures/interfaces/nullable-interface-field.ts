// @test-description: nullable interface field access reads correct field index
interface Config {
  alpha: string;
  beta: string;
  gamma: string;
}

class App {
  config: Config | undefined;

  constructor() {
    this.config = { alpha: "first", beta: "second", gamma: "third" };
  }

  getGamma(): string {
    return this.config.gamma;
  }
}

const app = new App();
const val = app.getGamma();
if (val === "third") {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: expected 'third', got '" + val + "'");
}
