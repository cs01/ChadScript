const str = "Map<string, number>";
const result = str.match(/^Map<(\w+),\s*(.+)>$/);

console.log(result[0]);
console.log(result[1]);
console.log(result[2]);
