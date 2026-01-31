class Config {
  enabled: boolean;
  count: number;
  name: string;
  
  constructor() {
    this.enabled = false;
    this.count = 0;
    this.name = "default";
  }
}

const config = new Config();
console.log("Initially enabled:");
console.log(config.enabled);

// This is the property assignment we want to test
config.enabled = true;
config.count = 42;
config.name = "updated";

console.log("After assignment:");
console.log(config.enabled);
console.log(config.count);
console.log(config.name);

if (config.enabled && config.count === 42 && config.name === "updated") {
  console.log("TEST_PASSED");
} else {
  console.log("TEST_FAILED");
  process.exit(1);
}
