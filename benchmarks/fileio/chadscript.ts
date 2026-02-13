const CHUNK_SIZE = 1024;
const CHUNKS = 1024;
const FILE_PATH = "/tmp/bench-fileio-test.dat";

function run(): void {
  let base = "";
  let i = 0;
  while (i < 100) {
    base = base + "abcdefghij";
    i = i + 1;
  }

  let chunk = "";
  let k = 0;
  while (k < 10) {
    chunk = chunk + base;
    k = k + 1;
  }
  chunk = chunk + base;
  const chunkLen = chunk.length;

  const start = Date.now();

  let data = "";
  let c = 0;
  while (c < CHUNKS) {
    data = data + chunk;
    c = c + 1;
  }
  fs.writeFileSync(FILE_PATH, data);

  const readBack = fs.readFileSync(FILE_PATH);

  const elapsed = (Date.now() - start) / 1000;
  const bytes = readBack.length;

  fs.unlinkSync(FILE_PATH);

  console.log("Written:  " + bytes);
  console.log("Read:     " + readBack.length);
  console.log("Time:     " + elapsed + "s");
}

run();
