// @expect-reject: CS1226
// A dynamic `import()` has no compile-time module graph edge.
async function main(): Promise<void> {
  const path = await import("node:path");
  console.log(path.join("a", "b"));
}

main();
