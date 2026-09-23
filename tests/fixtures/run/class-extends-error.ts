// @known-bug: `class X extends Error` passes the validator and then ICEs in lower ("`super()` with no base class"); should be admitted or rejected with a CS code
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
