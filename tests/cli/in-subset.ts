// In the subset: `chad run --fallback=node` still compiles and runs it natively.
const args: string[] = process.argv.slice(2);
console.log("native", args.join(","));
process.exit(4);
