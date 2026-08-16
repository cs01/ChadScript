// @expect-reject: CS0001
// The ambient declaration is the allowlist: `rm` is not ported.
import { rm } from "node:fs/promises";

async function main(): Promise<void> {
  await rm("/tmp/nope");
}
main();
