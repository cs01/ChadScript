// Debug process.argv

console.log("argc: " + process.argv.length);
console.log("argv[0]: " + process.argv[0]);

if (process.argv.length > 1) {
  console.log("argv[1]: " + process.argv[1]);
  console.log("argv[1].length: " + process.argv[1].length);
}

process.exit(0);
