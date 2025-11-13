// Test string length comparison
const emptyStr = "";
console.log("Empty string length: " + emptyStr.length);

if (emptyStr.length === 0) {
  console.log("Empty string is empty");
  process.exit(10);
}

console.log("This should not print");
process.exit(1);
