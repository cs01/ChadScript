// Test new string methods: trim, indexOf, includes, slice

const s1 = "  hello  ";
console.log("trim('  hello  ')='" + s1.trim() + "'");

const s2 = "\thello\n";
console.log("trim('\\thello\\n')='" + s2.trim() + "'");

const s3 = "hello world";
console.log("indexOf('world')=" + s3.indexOf("world"));
console.log("indexOf('xyz')=" + s3.indexOf("xyz"));

const s4 = "hello world";
console.log("includes('world')=" + s4.includes("world"));
console.log("includes('xyz')=" + s4.includes("xyz"));

const s5 = "hello world";
console.log("slice(0,5)='" + s5.slice(0, 5) + "'");
console.log("slice(6)='" + s5.slice(6) + "'");
console.log("slice(-5)='" + s5.slice(-5) + "'");

process.exit(0);
