const a = "hello";
const b = "hello";
const c = "world";

if (a === b) {
  console.log("a === b: PASS");
} else {
  console.log("a === b: FAIL");
}

if (a === c) {
  console.log("a === c: FAIL (unexpected)");
} else {
  console.log("a !== c: PASS");
}

function checkName(name: string): boolean {
  return name === "test";
}

if (checkName("test")) {
  console.log("checkName('test'): PASS");
} else {
  console.log("checkName('test'): FAIL");
}

if (checkName("other")) {
  console.log("checkName('other'): FAIL (unexpected)");
} else {
  console.log("checkName('other') is false: PASS");
}
