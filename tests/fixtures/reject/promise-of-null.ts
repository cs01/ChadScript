// @expect-reject: CS1233
async function nothing(): Promise<null> {
  return null;
}
async function main(): Promise<void> {
  console.log(await nothing());
}
main();
