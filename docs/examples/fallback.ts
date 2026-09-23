// @expect-reject: CS1203
// `==` is outside the subset, so `chad run --fallback=node` runs this file under Node.
const args = process.argv.slice(2);
if (args.length == 0) {
  console.log("usage: fallback <word>...");
  process.exit(2);
}
console.log(`${args.length} word(s): ${args.join(" ")}`);
process.exit(3);
