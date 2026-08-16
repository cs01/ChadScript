// @expect-reject: CS1233
// And on a parameter, where the union would enter through the call boundary.
function show(v: string | number): void {
  console.log(v);
}
show(1);
