// @expect-reject: CS1000
// A class extending a built-in class: an Error here is the runtime's error record, not a class
// instance, so nothing can be both.
class MyError extends Error {
  code: number;
  constructor(code: number) {
    super("my");
    this.code = code;
  }
}
try {
  throw new MyError(3);
} catch (e) {
  console.log(String(e));
}
