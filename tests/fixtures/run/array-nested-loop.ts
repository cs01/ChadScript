const rows = [3, 5, 2];
for (const r of rows) {
  let line = "";
  for (let i = 0; i < r; i++) {
    line = line + "*";
  }
  console.log(line);
}
