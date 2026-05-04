interface Counter {
  id: number;
  count: number;
  flag1: boolean;
  flag2: boolean;
  init: boolean;
  done: boolean;
}

const m = new Map<number, Counter>();
m.set(1, { id: 1, count: 0, flag1: false, flag2: false, init: true, done: false });
m.set(2, { id: 2, count: 10, flag1: false, flag2: false, init: true, done: false });

function bump(map: Map<number, Counter>, id: number): void {
  const cur = map.get(id);
  if (cur) {
    cur.count = cur.count + 1;
  }
}

bump(m, 1);
bump(m, 1);
bump(m, 2);

console.log(m.get(1)!.count);
console.log(m.get(2)!.count);
