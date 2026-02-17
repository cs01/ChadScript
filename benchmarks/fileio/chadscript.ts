const CHUNK_SIZE = 102400;
const CHUNKS = 1024;
const FILE_PATH = "/tmp/bench-fileio-test.dat";

function run(): void {
  const chunk = "A".repeat(CHUNK_SIZE);

  const start = Date.now();

  fs.writeFileSync(FILE_PATH, chunk);
  let c = 1;
  while (c < CHUNKS) {
    fs.appendFileSync(FILE_PATH, chunk);
    c = c + 1;
  }

  const readBack = fs.readFileSync(FILE_PATH);

  const elapsed = (Date.now() - start) / 1000;

  fs.unlinkSync(FILE_PATH);

  const totalBytes = CHUNK_SIZE * CHUNKS;
  console.log("Written:  " + totalBytes);
  console.log("Read:     " + readBack.length);
  console.log("Time:     " + elapsed + "s");
}

run();
