// String conversions and instanceof on a caught value, for a thrown string and each error class.
class Mine {
  n = 1;
}
function show(thrower: () => void): void {
  try {
    thrower();
  } catch (e) {
    console.log(String(e));
    console.log(`[${e}]`);
    console.log("x" + e);
    console.log(e + "y");
    console.log(String(e).length);
    console.log(
      e instanceof Error,
      e instanceof TypeError,
      e instanceof RangeError,
      e instanceof SyntaxError,
      e instanceof Mine,
    );
    if (e instanceof Error) console.log(e.name, e.message);
    else console.log("thrown value:", String(e));
  }
}
show(() => {
  throw "plain";
});
show(() => {
  throw "";
});
show(() => {
  throw new Error("e");
});
show(() => {
  throw new Error();
});
show(() => {
  throw new TypeError("t");
});
show(() => {
  throw new RangeError("r");
});
show(() => {
  throw new SyntaxError("s");
});
const err: Error = new TypeError("typed");
console.log(err instanceof Mine, String(err));
