// Embedded-NUL strings: the UTF-8 {ptr,len} ABI must treat NUL as an ordinary byte, not a
// terminator. The old NUL-terminated cstring ABI silently truncated every string at the first
// \0 (strlen/strcmp/strstr/fputs), diverging from Node. Every op below crosses a NUL byte.
const s: string = "a\0b";
console.log(s); // raw 3 bytes: a, NUL, b
console.log(s.length); // 3, not 1
console.log(s + "c\0d"); // concat past both NULs
console.log(s.includes("\0")); // true
console.log(s.indexOf("b")); // 2
console.log(s.toUpperCase()); // A NUL B
console.log([s]); // nested inspect quotes + escapes: [ 'a\x00b' ]
console.log(s.split("\0")); // [ 'a', 'b' ]
console.log(s.slice(1)); // NUL b

const m = new Map<string, number>();
m.set("x\0y", 1);
m.set("x", 2); // a DISTINCT key — old ABI collapsed both to "x"
console.log(m.get("x\0y") ?? -1); // 1
console.log(m.get("x") ?? -1); // 2
console.log(m.size); // 2
