// @known-bug: phase 5 (erased generics): type parameters are rejected (CS1000)
function first<T>(xs: T[], d: T): T {
  return xs.length > 0 ? xs[0]! : d;
}
console.log(first([3, 4], 0), first(["a"], "z"), first<string>([], "z"));
