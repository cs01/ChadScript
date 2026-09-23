// typeof of a caught value is the thrown value's own typeof: "string" for a thrown string,
// "object" for an Error. Narrowing on it reads the thrown string itself.
function kindOf(thrower: () => void): string {
  try {
    thrower();
  } catch (e) {
    return typeof e;
  }
  return "none";
}
console.log(
  kindOf(() => {
    throw "s";
  }),
);
console.log(
  kindOf(() => {
    throw new Error("m");
  }),
);
console.log(
  kindOf(() => {
    throw new RangeError("r");
  }),
);

try {
  throw "boom";
} catch (e) {
  console.log(typeof e);
  console.log(`${typeof e}:${e}`);
  const t = typeof e;
  console.log(t === "string", t === "object");
  switch (typeof e) {
    case "string":
      console.log("switch: string");
      break;
    default:
      console.log("switch: other");
  }
  if (typeof e === "string") {
    console.log(e.length, e.toUpperCase());
  } else {
    console.log("not a string");
  }
  console.log(typeof e === "object", typeof e !== "string", typeof e === "number");
  const r = typeof e === "string" ? e + "!" : "?";
  console.log(r);
}

try {
  throw new TypeError("bad");
} catch (e) {
  if (typeof e === "string") {
    console.log("string?", e);
  } else if (typeof e === "object") {
    console.log("object");
  }
  console.log(typeof e === "string" ? e.length : -1);
}

const x: number = 3;
try {
  if (x > 1) throw `v=${x}`;
} catch (e) {
  console.log(typeof e === "string" ? e.toUpperCase() : "?");
}

// A rethrown string keeps its kind.
try {
  try {
    throw "inner";
  } catch (e) {
    throw e;
  }
} catch (e2) {
  console.log(typeof e2, String(e2));
}

const err = new Error("made");
console.log(typeof err);

async function fails(): Promise<void> {
  throw "async string";
}
async function main(): Promise<void> {
  try {
    await fails();
  } catch (e) {
    console.log(typeof e, String(e), e === "async string");
  }
}
main();
