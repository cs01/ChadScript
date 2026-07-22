const grid = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const cols = 3;
for (let r = 0; r < 3; r++) {
  let line = "";
  for (let c = 0; c < 3; c++) {
    const v = grid[r * cols + c] ?? 0;
    line = line + v + " ";
  }
  console.log(line);
}
