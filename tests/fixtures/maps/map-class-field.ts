class Config {
  data: Map<string, string> = new Map<string, string>();

  set(key: string, value: string): void {
    this.data.set(key, value);
  }

  get(key: string): string {
    return this.data.get(key);
  }
}

const config = new Config();
config.set("name", "chad");
config.set("version", "1.0");

const name = config.get("name");
const version = config.get("version");

if (name === "chad" && version === "1.0") {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: name=" + name + " version=" + version);
}
