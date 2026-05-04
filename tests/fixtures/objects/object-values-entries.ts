const o: any = JSON.parse('{"a": 1, "b": 2, "c": 3}');
const vs = Object.values(o);
console.log("values count:", vs.length);

const es = Object.entries(o);
console.log("entries count:", es.length);

let n = 0;
for (const v of vs) n++;
console.log("iter count:", n);
