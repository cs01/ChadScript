const rows: number[][] = [];
rows.push([1, 2, 3]);
rows.push([4, 5, 6]);

let pass = true;
if (rows[0][0] !== 1) {
  console.log("FAIL [0][0]");
  pass = false;
}
if (rows[0][1] !== 2) {
  console.log("FAIL [0][1]");
  pass = false;
}
if (rows[1][2] !== 6) {
  console.log("FAIL [1][2]");
  pass = false;
}

class Grid {
  data: number[][];
  constructor() {
    this.data = [];
  }
  addRow(row: number[]): void {
    this.data.push(row);
  }
}

const g = new Grid();
g.addRow([10, 20, 30]);
g.addRow([40, 50, 60]);

if (g.data[0][2] !== 30) {
  console.log("FAIL g[0][2]");
  pass = false;
}
if (g.data[1][1] !== 50) {
  console.log("FAIL g[1][1]");
  pass = false;
}

if (pass) console.log("TEST_PASSED");
