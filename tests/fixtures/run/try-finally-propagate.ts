function boom(): number {
  throw new Error("boom");
}
try {
  try {
    boom();
  } catch {
    console.log("inner catch, rethrowing");
    throw new Error("from catch");
  } finally {
    console.log("finally ran");
  }
} catch {
  console.log("outer caught");
}
console.log("survived");
