// @expect-reject: CS1217
function greet(name: string = "world"): string {
  return "hi " + name;
}
console.log(greet());
