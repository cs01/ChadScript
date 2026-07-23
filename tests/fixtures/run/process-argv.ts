// @args: alpha beta --flag=1
// `process.argv.slice(2)` is the user's arguments — identical under Node and as a native binary.
// (argv[0]/argv[1] are the node binary and script path, which a compiled binary has no equivalent
// for, so the slice is the only admitted form; see CS1229.)
const args = process.argv.slice(2);
console.log(args.length);
console.log(args.join("|"));
for (const a of args) {
  console.log(`[${a}]`);
}
console.log(args[0] ?? "none", args[9] ?? "none");
