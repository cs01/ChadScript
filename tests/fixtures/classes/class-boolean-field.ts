class Toggle {
  label: string;
  active: boolean;
  constructor(label: string, active: boolean) {
    this.label = label;
    this.active = active;
  }
}

function main(): void {
  const on = new Toggle("light", true);
  const off = new Toggle("fan", false);

  let result = "";
  if (on.active) {
    result = result + on.label + ":on,";
  }
  if (!off.active) {
    result = result + off.label + ":off";
  }

  if (result === "light:on,fan:off") {
    console.log("TEST_PASSED");
  } else {
    console.log("FAIL: " + result);
  }
}

main();
