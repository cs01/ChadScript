const raw = "  Hello, World!  ";
const trimmed = raw.trim();
if (trimmed !== "Hello, World!") process.exit(1);

const lower = trimmed.toLowerCase();
if (lower !== "hello, world!") process.exit(1);

const upper = trimmed.toUpperCase();
if (upper !== "HELLO, WORLD!") process.exit(1);

const replaced = trimmed.replace("World", "ChadScript");
if (replaced !== "Hello, ChadScript!") process.exit(1);

const csv = "one,two,three,four,five";
const parts = csv.split(",");
if (parts.length !== 5) process.exit(1);
if (parts[0] !== "one") process.exit(1);
if (parts[4] !== "five") process.exit(1);

const rejoined = parts.join("-");
if (rejoined !== "one-two-three-four-five") process.exit(1);

const sentence = "the quick brown fox jumps over the lazy dog";
const hasQuick = sentence.includes("quick");
if (!hasQuick) process.exit(1);

const foxIdx = sentence.indexOf("fox");
if (foxIdx !== 16) process.exit(1);

const sub = sentence.substring(4, 9);
if (sub !== "quick") process.exit(1);

const padded = "42".padStart(5, "0");
if (padded !== "00042") process.exit(1);

console.log("TEST_PASSED");
