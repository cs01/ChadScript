// @expect-reject: CS1000
// Method shorthand in an object literal: objects hold data and closures, not methods.
interface Greeter {
  name: string;
  greet(): string;
}
const g: Greeter = {
  name: "x",
  greet() {
    return "hi " + this.name;
  },
};
console.log(g.greet());
