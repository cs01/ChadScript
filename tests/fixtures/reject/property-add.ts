// @expect-reject: CS1235
// `a` was created without `age`; assigning it would ADD a property, which objects cannot do.
interface R {
  name: string;
  age?: number;
}
const a: R = { name: "a" };
a.age = 3;
console.log(a.age);
