const CHUNK_SIZE = 102400;
const CHUNKS = 1024;
const FILE_PATH = "/tmp/bench-fileio-test.dat";

function run(): void {
  const data = "A".repeat(CHUNK_SIZE * CHUNKS);

  const start = Date.now();

  fs.writeFileSync(FILE_PATH, data);

  const readBack = fs.readFileSync(FILE_PATH);

  const elapsed = (Date.now() - start) / 1000;
  const bytes = readBack.length;

  fs.unlinkSync(FILE_PATH);

  console.log("Written:  " + data.length);
  console.log("Read:     " + bytes);
  console.log("Time:     " + elapsed + "s");
}

run();
