// Was a CS1233 rejection: a declared Value union (tsc narrows the read to the initializer's type).
const value: string | number = "hello";
console.log(value);
