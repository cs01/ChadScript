const words = "hello world foo bar".split(" ");

if (words.length !== 4) {
  process.exit(1);
}

const filtered = words.filter((w: string) => w.length > 3);
if (filtered.length !== 2) {
  process.exit(1);
}
if (filtered[0] !== "hello") {
  process.exit(1);
}
if (filtered[1] !== "world") {
  process.exit(1);
}

const upper: string[] = [];
words.forEach((w: string) => {
  upper.push(w.toUpperCase());
});
if (upper[0] !== "HELLO") {
  process.exit(1);
}

const hasShort = words.some((w: string) => w.length <= 3);
if (!hasShort) {
  process.exit(1);
}

const allNonEmpty = words.every((w: string) => w.length > 0);
if (!allNonEmpty) {
  process.exit(1);
}

const found = words.find((w: string) => w === "foo");
if (found !== "foo") {
  process.exit(1);
}

const idx = words.findIndex((w: string) => w === "bar");
if (idx !== 3) {
  process.exit(1);
}

console.log("TEST_PASSED");
