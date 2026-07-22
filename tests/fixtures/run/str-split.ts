const csv = "one,two,three";
const parts = csv.split(",");
console.log(parts.length);
for (const p of parts) {
  console.log(p);
}
console.log("abc".split("").length);
