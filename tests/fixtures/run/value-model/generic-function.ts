function first<T>(xs: T[], d: T): T {
  return xs.length > 0 ? xs[0]! : d;
}
console.log(first([3, 4], 0), first(["a"], "z"), first<string>([], "z"));
