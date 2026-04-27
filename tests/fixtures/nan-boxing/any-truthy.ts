let x: any = 1;
if (x) {
  console.log("truthy");
}
let y: any = 0;
if (y) {
  console.log("should not print");
} else {
  console.log("falsy");
}
let z: any = "";
if (z) {
  console.log("should not print");
} else {
  console.log("empty string falsy");
}
