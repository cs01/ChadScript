console.log("argc:");
console.log(process.argv.length);
console.log("first arg:");
if (process.argv.length > 0) {
  console.log(process.argv[0]);
}
console.log("done");
