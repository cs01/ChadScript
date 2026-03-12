const empty = "";
const s = "hello";

if (empty.indexOf("x") !== -1) throw new Error("indexOf empty");
if (empty.lastIndexOf("x") !== -1) throw new Error("lastIndexOf empty");
if (empty.includes("x")) throw new Error("includes empty");
if (empty.startsWith("x")) throw new Error("startsWith empty");
if (empty.endsWith("x")) throw new Error("endsWith empty");

if (empty.trim() !== "") throw new Error("trim empty");
if (empty.toUpperCase() !== "") throw new Error("toUpperCase empty");
if (empty.toLowerCase() !== "") throw new Error("toLowerCase empty");
if (empty.repeat(100) !== "") throw new Error("repeat empty");
if (empty.padStart(3, "x") !== "xxx") throw new Error("padStart empty");
if (empty.padEnd(3, "x") !== "xxx") throw new Error("padEnd empty");

if (empty.replace("a", "b") !== "") throw new Error("replace empty");
if (empty.replaceAll("a", "b") !== "") throw new Error("replaceAll empty");

const split1 = empty.split(",");
if (split1.length !== 1) throw new Error("split empty by comma should give ['']");
if (split1[0] !== "") throw new Error("split empty element");

if (s.substring(100, 200) !== "") throw new Error("substring out of range");
if (s.substring(-5, -1) !== "") throw new Error("substring negative");

if (s.slice(100) !== "") throw new Error("slice past end");
if (s.slice(-100) !== "hello") throw new Error("slice very negative");
if (s.slice(2, 2) !== "") throw new Error("slice equal indices");

if (s.indexOf("x", 100) !== -1) throw new Error("indexOf past end");
if (s.indexOf("l", -100) !== 2) throw new Error("indexOf negative from");

if (s.charAt(100) !== "") throw new Error("charAt out of bounds");

if (s.substr(100) !== "") throw new Error("substr past end");
if (s.substr(0, 0) !== "") throw new Error("substr zero length");

console.log("TEST_PASSED");
