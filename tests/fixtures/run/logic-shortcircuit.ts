function sideEffect(label: string, ret: boolean): boolean {
  console.log("called", label);
  return ret;
}
console.log("--- && short circuit (left false, right skipped) ---");
const a = sideEffect("A", false) && sideEffect("B", true);
console.log(a);
console.log("--- || short circuit (left true, right skipped) ---");
const b = sideEffect("C", true) || sideEffect("D", false);
console.log(b);
