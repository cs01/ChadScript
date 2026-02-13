const COUNT = 100000;
const DELIM = ",";

function run(): void {
  const start = Date.now();

  let big = "";
  let i = 0;
  while (i < COUNT) {
    if (i > 0) {
      big = big + DELIM;
    }
    big = big + "item" + i;
    i = i + 1;
  }

  const parts = big.split(DELIM);

  let result = "";
  let j = 0;
  while (j < parts.length) {
    if (j > 0) {
      result = result + DELIM;
    }
    result = result + parts[j].toUpperCase();
    j = j + 1;
  }

  const elapsed = (Date.now() - start) / 1000;
  console.log("Strings:  " + COUNT);
  console.log("Length:   " + result.length);
  console.log("Time:     " + elapsed + "s");
}

run();
