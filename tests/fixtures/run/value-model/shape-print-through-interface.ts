// console.log, JSON.stringify and Object.keys/values read an object's own shape, not the static
// type it is seen through: extra fields, allocation order, class names and absent optionals.
interface HasX {
  x: number;
}
class Pt {
  y = 2;
  x = 1;
}
const lit = { z: 3, x: 4 };
const views: HasX[] = [lit, new Pt(), { x: 5 }];
for (const v of views) {
  console.log(v);
  console.log(JSON.stringify(v));
  console.log(Object.keys(v).join(","), Object.values(v).join(","));
}
type Opt = { name: string; age?: number };
const people: Opt[] = [{ name: "a" }, { name: "b", age: 3 }];
console.log(people);
console.log(JSON.stringify(people, null, 2));
const nested = { outer: { inner: { deep: { deeper: 1 } } }, p: new Pt() };
console.log(nested);
