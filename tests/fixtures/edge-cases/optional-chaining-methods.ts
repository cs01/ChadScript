interface Config {
  debug: boolean;
  name: string;
}

function getConfig(flag: boolean): Config | null {
  if (flag) {
    return { debug: true, name: "test" };
  }
  return null;
}

const c1 = getConfig(true);
const c2 = getConfig(false);

if (c1 !== null) {
  if (c1.name !== "test") {
    process.exit(1);
  }
}

if (c2 !== null) {
  process.exit(1);
}

const arr = [1, 2, 3];
const str = "hello";

if (arr.length !== 3) {
  process.exit(1);
}

if (str.length !== 5) {
  process.exit(1);
}

if (str.indexOf("ell") !== 1) {
  process.exit(1);
}

if (str.includes("lo") !== true) {
  process.exit(1);
}

console.log("TEST_PASSED");
