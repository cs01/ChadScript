const xs = [10, 20, 30];
const a = xs[1];
if (a !== undefined) {
  console.log("got", a * 2);
} else {
  console.log("none");
}
const b = xs[9];
if (b === undefined) {
  console.log("missing");
}
