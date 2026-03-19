// @test-native-only
const a = parseInt("42");
if (a !== 42) process.exit(1);

const b = parseInt("-17");
if (b !== -17) process.exit(1);

const c = parseFloat("3.14");
if (c !== 3.14) process.exit(1);

const d = Number("99");
if (d !== 99) process.exit(1);

const e = Number("0");
if (e !== 0) process.exit(1);

const n1 = 42;
const f = n1.toString();
if (f !== "42") process.exit(1);

const n2 = 0;
const g = n2.toString();
if (g !== "0") process.exit(1);

const nan1 = parseInt("abc");
if (!isNaN(nan1)) process.exit(1);

const nan2 = parseFloat("xyz");
if (!isNaN(nan2)) process.exit(1);

console.log("TEST_PASSED");
