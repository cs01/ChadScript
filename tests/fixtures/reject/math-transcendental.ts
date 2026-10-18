// @expect-reject: CS1220
// Node's last bit for these differs across its versions and CPU architectures.
console.log(Math.sin(1), Math.log(10));
