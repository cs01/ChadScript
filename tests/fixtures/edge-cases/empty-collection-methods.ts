const empty: number[] = [];

const filtered = empty.filter((n: number) => n > 0);
if (filtered.length !== 0) {
  process.exit(1);
}

const mapped = empty.map((n: number) => n * 2);
if (mapped.length !== 0) {
  process.exit(1);
}

const found = empty.find((n: number) => n > 0);

const idx = empty.findIndex((n: number) => n > 0);
if (idx !== -1) {
  process.exit(1);
}

const has = empty.includes(5);
if (has) {
  process.exit(1);
}

const some = empty.some((n: number) => n > 0);
if (some) {
  process.exit(1);
}

const every = empty.every((n: number) => n > 0);
if (!every) {
  process.exit(1);
}

const joined = empty.join(",");
if (joined !== "") {
  process.exit(1);
}

const sliced = empty.slice(0, 5);
if (sliced.length !== 0) {
  process.exit(1);
}

const emptyStr: string[] = [];
const strFiltered = emptyStr.filter((s: string) => s.length > 0);
if (strFiltered.length !== 0) {
  process.exit(1);
}

const strJoined = emptyStr.join("-");
if (strJoined !== "") {
  process.exit(1);
}

console.log("TEST_PASSED");
