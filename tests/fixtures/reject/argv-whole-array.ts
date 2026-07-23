// @expect-reject: CS1229
// Reading argv[0]/argv[1] (node binary, script path) can never agree with a compiled binary.
const all = process.argv;
console.log(all.length);
