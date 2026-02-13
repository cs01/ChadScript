const CHUNK_SIZE = 100 * 1024;
const CHUNKS = 1024;
const FILE_PATH = "/tmp/bench-fileio-test.dat";

const chunk = "A".repeat(CHUNK_SIZE);

const start = performance.now();

let data = "";
for (let i = 0; i < CHUNKS; i++) {
  data += chunk;
}
Bun.write(FILE_PATH, data);

const readBack = await Bun.file(FILE_PATH).text();

const elapsed = (performance.now() - start) / 1000;

const { unlinkSync } = await import("node:fs");
unlinkSync(FILE_PATH);

console.log(`Written:  ${data.length}`);
console.log(`Read:     ${readBack.length}`);
console.log(`Time:     ${elapsed.toFixed(3)}s`);
