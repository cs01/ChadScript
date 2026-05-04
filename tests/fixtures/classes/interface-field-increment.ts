interface Counter {
  count: number;
  flag: boolean;
}

const m = new Map<number, Counter>();
m.set(1, { count: 0, flag: false });
m.set(2, { count: 10, flag: false });

const a = m.get(1);
if (a) {
  a.count = a.count + 1;
  a.count = a.count + 1;
  a.flag = true;
}

const b = m.get(2);
if (b) {
  b.count = b.count + 5;
}

console.log(m.get(1)!.count);
console.log(m.get(1)!.flag);
console.log(m.get(2)!.count);
