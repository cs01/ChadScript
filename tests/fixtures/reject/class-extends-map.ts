// @expect-reject: CS1000
class Counts extends Map<string, number> {}
console.log(new Counts().size);
