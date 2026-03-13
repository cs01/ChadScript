const words = "hello world foo bar baz";
const parts = words.split(" ");
if (parts.length !== 5) process.exit(1);

const sorted = parts.sort();
if (sorted[0] !== "bar") process.exit(1);
if (sorted[1] !== "baz") process.exit(1);
if (sorted[4] !== "world") process.exit(1);

const filtered = parts.filter((w: string) => w.length > 3);
if (filtered.length !== 2) process.exit(1);

const mapped = parts.map((w: string) => w.toUpperCase());
if (mapped[0] !== "BAR") process.exit(1);

const joined = parts.join(", ");
if (joined !== "bar, baz, foo, hello, world") process.exit(1);

console.log("TEST_PASSED");
