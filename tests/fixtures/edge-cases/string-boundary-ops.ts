const empty = "";
if (empty.length !== 0) {
  process.exit(1);
}

const trimmed = empty.trim();
if (trimmed !== "") {
  process.exit(1);
}

const upper = empty.toUpperCase();
if (upper !== "") {
  process.exit(1);
}

const lower = empty.toLowerCase();
if (lower !== "") {
  process.exit(1);
}

const idx = empty.indexOf("x");
if (idx !== -1) {
  process.exit(1);
}

const inc = empty.includes("x");
if (inc) {
  process.exit(1);
}

const rep = empty.replace("a", "b");
if (rep !== "") {
  process.exit(1);
}

const sub = empty.substring(0, 0);
if (sub !== "") {
  process.exit(1);
}

const sliced = empty.slice(0, 0);
if (sliced !== "") {
  process.exit(1);
}

const split = empty.split(",");
if (split.length !== 1) {
  process.exit(1);
}
if (split[0] !== "") {
  process.exit(1);
}

const long = "abcdefghijklmnopqrstuvwxyz";
const atEnd = long.charAt(25);
if (atEnd !== "z") {
  process.exit(1);
}

const pastEnd = long.charAt(100);
if (pastEnd !== "") {
  process.exit(1);
}

const negAt = long.at(-1);
if (negAt !== "z") {
  process.exit(1);
}

const starts = long.startsWith("abc");
if (!starts) {
  process.exit(1);
}

const ends = long.endsWith("xyz");
if (!ends) {
  process.exit(1);
}

console.log("TEST_PASSED");
