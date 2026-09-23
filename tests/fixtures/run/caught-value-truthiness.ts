// Truthiness, Boolean() and Number() of a caught value follow the thrown value.
function check(thrower: () => void): void {
  try {
    thrower();
  } catch (e) {
    if (e) console.log("truthy");
    else console.log("falsy");
    console.log(!e, e ? 1 : 2, Boolean(e), Number(e));
  }
}
check(() => {
  throw "";
});
check(() => {
  throw "s";
});
check(() => {
  throw "12";
});
check(() => {
  throw "  3.5 ";
});
check(() => {
  throw "0x10";
});
check(() => {
  throw new Error("");
});
check(() => {
  throw new Error("7");
});
check(() => {
  throw new SyntaxError("x");
});

// Tests that narrow a caught value to `{}` or `{} | null` keep reading the caught value.
try {
  throw "s";
} catch (e) {
  console.log(e !== undefined && e !== null, e !== null ? String(e) : "null");
  console.log(Array.isArray(e), typeof e === "number", typeof e === "undefined");
}
