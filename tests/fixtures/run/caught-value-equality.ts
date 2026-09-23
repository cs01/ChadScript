// `===` / `!==` / `switch` on a caught value compare it as the thrown value: a thrown string by its
// text, an Error by identity.
function pick(n: number): string | number {
  return n > 2 ? 5 : "s";
}
function maybe(n: number): string | undefined {
  return n > 2 ? undefined : "s";
}
try {
  throw "s";
} catch (e) {
  console.log(e === "s", e !== "s", "s" === e, "t" !== e, e === "t");
  console.log(e === "s" ? e.length : -1);
  console.log(e === 1, e !== 1, e === true, e === null, e === undefined);
  const u = pick(1);
  console.log(e === u, u === e, e !== u);
  const o = maybe(1);
  console.log(e === o, o !== e);
  switch (e) {
    case "t":
      console.log("case t");
      break;
    case "s":
      console.log("case s");
      break;
    default:
      console.log("default");
  }
}

// Two separately thrown strings with the same text are ===, as in Node.
try {
  throw "a";
} catch (a) {
  try {
    throw "a";
  } catch (b) {
    console.log(a === b, a !== b);
  }
  try {
    throw "b";
  } catch (c) {
    console.log(a === c);
  }
}

// Errors compare by identity, and never equal their message.
const shared = new Error("m");
try {
  throw shared;
} catch (e) {
  console.log(e === shared, e === "m", e === "Error: m", e === new Error("m"));
  switch (e) {
    case "m":
      console.log("case m");
      break;
    default:
      console.log("default");
  }
}
function lastOf(errs: Error[]): Error | undefined {
  return errs[errs.length - 1];
}
const kept = lastOf([shared]);
const none = lastOf([]);
try {
  throw shared;
} catch (e) {
  console.log(e === kept, kept === e, e === none, none !== e);
}
try {
  throw new Error("m");
} catch (a) {
  try {
    throw new Error("m");
  } catch (b) {
    console.log(a === b);
  }
}
