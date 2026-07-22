// String.prototype.concat edge cases: zero args returns the receiver; many args fold left; the
// binary runtime concat is NUL-safe so an embedded NUL survives the fold.
const a: string = "foo";
const b: string = "bar";
console.log(a.concat(b, "baz")); // foobarbaz
console.log(a.concat()); // foo — no args returns the receiver
console.log(a.concat("\0", b)); // foo NUL bar
console.log(a.concat(b).length); // 6
