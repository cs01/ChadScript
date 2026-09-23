// @known-bug: phase 3 (shaped objects): a class instance and a literal share one interface array
class A {
  a = 1;
  b = "x";
}
interface HasB {
  b: string;
}
const arr: HasB[] = [new A(), { b: "lit" }];
for (const h of arr) console.log(h.b);
