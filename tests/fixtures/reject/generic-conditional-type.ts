// @expect-reject: CS1243
type Elem<T> = T extends (infer U)[] ? U : T;
const x: Elem<number[]> = 1;
console.log(x);
