const CHUNKS = 1024;
const FILE_PATH = "/tmp/bench-fileio-test.dat";

function run(): void {
  const chunk = "A".repeat(102400);

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
