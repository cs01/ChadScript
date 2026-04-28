const buf = Buffer.from("hello");
console.log(buf.length);
console.log(buf.toString());
const hex = Buffer.from("48656c6c6f", "hex");
console.log(hex.toString());
const alloc = Buffer.alloc(4);
console.log(alloc.length);
console.log(alloc.toString("hex"));
