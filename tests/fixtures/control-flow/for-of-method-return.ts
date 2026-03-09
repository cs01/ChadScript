interface Point {
  x: number;
  y: number;
}

function getPoints(): Point[] {
  return [
    { x: 1, y: 2 },
    { x: 3, y: 4 },
    { x: 5, y: 6 },
  ];
}

function getNumbers(): number[] {
  return [10, 20, 30];
}

function getStrings(): string[] {
  return ["hello", "world"];
}

let passed = true;

let sumX = 0;
for (const p of getPoints()) {
  sumX = sumX + p.x;
}
if (sumX !== 9) {
  console.log("FAIL: sumX expected 9 got " + sumX);
  passed = false;
}

let sumN = 0;
for (const n of getNumbers()) {
  sumN = sumN + n;
}
if (sumN !== 60) {
  console.log("FAIL: sumN expected 60 got " + sumN);
  passed = false;
}

let concat = "";
for (const s of getStrings()) {
  concat = concat + s;
}
if (concat !== "helloworld") {
  console.log("FAIL: concat expected 'helloworld' got '" + concat + "'");
  passed = false;
}

if (passed) {
  console.log("TEST_PASSED");
}
