// Was a CS1233 rejection: a Value union entering through a parameter.
function show(v: string | number): void {
  console.log(v);
}
show(1);
