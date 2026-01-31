class Flags {
  enabled: boolean;
  count: number;
  
  constructor() {
    this.enabled = false;
    this.count = 0;
  }
  
  enable(): void {
    this.enabled = true;
    this.count = this.count + 1;
  }
  
  isEnabled(): number {
    if (this.enabled) {
      return 1;
    }
    return 0;
  }
}

const flags = new Flags();
console.log("Initially enabled:");
console.log(flags.isEnabled());

flags.enable();
console.log("After enable:");
console.log(flags.isEnabled());
console.log("Count:");
console.log(flags.count);

if (flags.isEnabled() > 0) {
  console.log("TEST_PASSED");
} else {
  console.log("TEST_FAILED");
  process.exit(1);
}
