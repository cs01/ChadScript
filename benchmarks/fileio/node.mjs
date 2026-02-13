import { writeFileSync, readFileSync, unlinkSync } from "node:fs";

const CHUNK_SIZE = 100 * 1024;
const CHUNKS = 1024;
const FILE_PATH = "/tmp/bench-fileio-test.dat";

const chunk = "A".repeat(CHUNK_SIZE);

const start = performance.now();

let data = "";
for (let i = 0; i < CHUNKS; i++) {
  data += chunk;
}
writeFileSync(FILE_PATH, data);

const readBack = readFileSync(FILE_PATH, "utf8");

const elapsed = (performance.now() - start) / 1000;

unlinkSync(FILE_PATH);

console.log(`Written:  ${data.length}`);
console.log(`Read:     ${readBack.length}`);
console.log(`Time:     ${elapsed.toFixed(3)}s`);
