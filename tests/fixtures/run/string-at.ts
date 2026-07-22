const s = "hello";
console.log(s.at(0) ?? "?");
console.log(s.at(-1) ?? "?");
console.log(s.at(-2) ?? "?");
console.log(s.at(10) ?? "?");
console.log(s.at(-10) ?? "?");
