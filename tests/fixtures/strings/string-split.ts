const csv: string = "hello,world,foo,bar";
const parts: string[] = csv.split(",");
console.log(parts.length);
console.log(parts[0]);
console.log(parts[1]);
console.log(parts[2]);
console.log(parts[3]);

const sentence: string = "one two three";
const words: string[] = sentence.split(" ");
console.log(words.length);
console.log(words.join("-"));

const s: string = "42";
console.log(parseInt(s));
console.log(parseFloat("3.14"));

const padded: string = "5".padStart(3, "0");
console.log(padded);
const padded2: string = "hi".padEnd(5, ".");
console.log(padded2);

console.log("  hello  ".trimStart());
console.log("  hello  ".trimEnd());
