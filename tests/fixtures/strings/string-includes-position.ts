const str = "hello world hello";

if (!str.includes("world", 0)) {
  console.log("FAIL: includes world from 0");
  process.exit(1);
}

if (str.includes("hello", 6)) {
  if (str.includes("hello", 13)) {
    console.log("FAIL: includes hello from 13 should be false");
    process.exit(1);
  }
} else {
  console.log("FAIL: includes hello from 6 should be true");
  process.exit(1);
}

if (str.includes("world", 20)) {
  console.log("FAIL: includes from past end should be false");
  process.exit(1);
}

if (!str.includes("hello", -5)) {
  console.log("FAIL: includes with negative position should search from 0");
  process.exit(1);
}

if (str.includes("xyz", 0)) {
  console.log("FAIL: includes non-existent should be false");
  process.exit(1);
}

console.log("TEST_PASSED");
