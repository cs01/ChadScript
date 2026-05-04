try {
  throw new Error("first error");
} catch (e: any) {
  console.log("a=" + e.message);
}

try {
  throw new Error("second error");
} catch (e: any) {
  console.log("b=" + (e as any).message);
}

function inner(): void {
  throw new Error("nested");
}
try {
  inner();
} catch (err: any) {
  console.log("c=" + err.message);
}
