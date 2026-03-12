let passed = true;

if ("abc" === "def") passed = false;
if (!("abc" === "abc")) passed = false;
if ("abc" !== "abc") passed = false;
if (!("abc" !== "def")) passed = false;
if (!("abc" < "def")) passed = false;
if ("def" < "abc") passed = false;
if (!("abc" <= "abc")) passed = false;
if (!("abc" <= "def")) passed = false;
if (!("def" > "abc")) passed = false;
if ("abc" > "def") passed = false;
if (!("abc" >= "abc")) passed = false;

const a = "hello";
const b = "world";
if (!(a < b)) passed = false;
if (a > b) passed = false;
if (a === b) passed = false;
if (!(a !== b)) passed = false;

if (passed) {
  console.log("TEST_PASSED");
}
