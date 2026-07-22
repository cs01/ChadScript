const names = ["alice", "bob"];
names.push("carol");
console.log(names.length);
let joined = "";
for (const n of names) {
  joined = joined + n + ",";
}
console.log(joined);
