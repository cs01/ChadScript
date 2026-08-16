// @expect-reject: CS1226
// A namespace import needs a module object at runtime; allowlisting the specifier does not admit
// every import form.
import * as fsp from "node:fs/promises";

async function main(): Promise<void> {
  await fsp.unlink("/tmp/nope");
}
main();
