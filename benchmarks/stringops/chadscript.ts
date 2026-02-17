const COUNT = 100000;
const DELIM = ",";

function run(): void {
  const start = Date.now();

  const pieces: string[] = [];
  let i = 0;
  while (i < COUNT) {
    pieces.push("item" + i);
    i = i + 1;
  }
  const big = pieces.join(DELIM);

  const parts = big.split(DELIM);

  let j = 0;
  while (j < parts.length) {
    parts[j] = parts[j].toUpperCase();
    j = j + 1;
  }
  const result = parts.join(DELIM);

  const elapsed = (Date.now() - start) / 1000;
  console.log("Strings:  " + COUNT);
  console.log("Length:   " + result.length);
  console.log("Time:     " + elapsed + "s");
}

run();
