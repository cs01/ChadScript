// @test-description: empty string from method calls and member access is falsy
interface Named {
  name: string;
}

function getStr(): string {
  return "";
}

function getNonEmpty(): string {
  return "hello";
}

let passed = true;

const str = "  ";
if (str.trim()) {
  passed = false;
}

const nonEmpty = "hello";
if (!nonEmpty.trim()) {
  passed = false;
}

const obj: Named = { name: "" };
if (obj.name) {
  passed = false;
}

const obj2: Named = { name: "alice" };
if (!obj2.name) {
  passed = false;
}

if (getStr()) {
  passed = false;
}

if (!getNonEmpty()) {
  passed = false;
}

if (passed) {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL");
}
