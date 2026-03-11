let passed = true;

const empty = "";
if (empty.length !== 0) passed = false;
if (empty.trim() !== "") passed = false;
if (empty.toUpperCase() !== "") passed = false;
if (empty.toLowerCase() !== "") passed = false;

const s = "Hello, World!";
if (s.indexOf("World") !== 7) passed = false;
if (s.indexOf("xyz") !== -1) passed = false;
if (s.startsWith("Hello") !== true) passed = false;
if (s.endsWith("!") !== true) passed = false;

const repeated = "ab".repeat(3);
if (repeated !== "ababab") passed = false;

const padded = "5".padStart(3, "0");
if (padded !== "005") passed = false;

const padEnd = "5".padEnd(3, "0");
if (padEnd !== "500") passed = false;

if (passed) {
  console.log("TEST_PASSED");
} else {
  console.log("FAILED");
}
