function getPoint(x: number, y: number) {
  return { x: x, y: y };
}

const p = getPoint(3, 4);
console.log(p.x);
console.log(p.y);

function makeInfo(name: string, age: number) {
  return { name: name, age: age };
}

const info = makeInfo("Alice", 30);
console.log(info.name);
console.log(info.age);

const obj = { greeting: "hello", count: 42, flag: true };
console.log(obj.greeting);
console.log(obj.count);
console.log(obj.flag);
