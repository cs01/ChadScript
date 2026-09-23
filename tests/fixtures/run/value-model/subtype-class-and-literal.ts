class A {
  a = 1;
  b = "x";
}
interface HasB {
  b: string;
}
const arr: HasB[] = [new A(), { b: "lit" }];
for (const h of arr) console.log(h.b);
