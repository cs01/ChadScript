// String conversion of objects and arrays, the way Node does it: arrays join with ",", nested
// arrays flatten, nullish elements join as "", plain objects are "[object Object]", and an object
// whose declared class or interface has toString() converts by calling it.
interface P {
  x: number;
}
const p: P = { x: 1 };
console.log(String(p), `${p}`, "p=" + p);

class Plain {
  n: number = 2;
}
console.log(String(new Plain()));

class Temp {
  c: number;
  constructor(c: number) {
    this.c = c;
  }
  toString(): string {
    return this.c + "C";
  }
}
class Hot extends Temp {
  override toString(): string {
    return "hot " + super.toString();
  }
}
const t: Temp = new Temp(20);
const h: Temp = new Hot(40);
console.log(String(t), `${h}`, "t=" + t);
let acc = "acc:";
acc += h;
console.log(acc);

interface Named {
  name: string;
  toString(): string;
}
class Dog implements Named {
  name: string = "rex";
  toString(): string {
    return "dog " + this.name;
  }
}
const lit: Named = { name: "lit", toString: (): string => "literal" };
const named: Named[] = [new Dog(), lit];
for (const n of named) console.log(`${n}`);

const xs: number[][] = [[1, 2], [3], []];
console.log(`${xs}`, String(xs), xs.join(";"));
const ys: (number | null | undefined)[] = [1, null, 2, undefined];
console.log(`[${ys}]`);
const ps: P[] = [p, { x: 2 }];
console.log(`${ps}`, ps.join(" "));
const m = new Map<string, number>();
const s = new Set<number>();
console.log(`${m} ${s}`);
const maybe: P | undefined = ps.length > 5 ? p : undefined;
console.log(`${maybe}`);
const words: string[] = ["a", "b"];
console.log("w=" + words);
