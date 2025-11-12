const empty = "";
console.log("Length: " + empty.length);

if (empty.length === 0) {
  console.log("Equals zero");
  process.exit(42);
}

console.log("Does NOT equal zero");
process.exit(1);
