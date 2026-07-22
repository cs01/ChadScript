function a(): string {
  try {
    return "from-try";
  } finally {
    console.log("a: finally ran");
  }
}
function b(): string {
  try {
    return "from-try";
  } finally {
    return "from-finally";
  }
}
function c(x: number): string {
  try {
    if (x < 0) {
      throw new Error("neg");
    }
    return "ok";
  } catch {
    return "caught";
  } finally {
    console.log("c: cleanup for " + x);
  }
}
function nested(): number {
  try {
    try {
      return 1;
    } finally {
      console.log("inner finally");
    }
  } finally {
    console.log("outer finally");
  }
}
function tryCatchReturn(): string {
  try {
    return "t";
  } catch {
    return "c";
  }
}
console.log(a());
console.log(b());
console.log(c(5));
console.log(c(-1));
console.log(nested());
console.log(tryCatchReturn());
