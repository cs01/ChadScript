const k = "name";
const o: any = { [k]: "alice", age: 30 };
console.log(o.name);
console.log(o.age);

const dynKey = "score";
const obj2: any = { id: 1, [dynKey]: 100 };
console.log(obj2.id);
console.log(obj2.score);
