// @chadscript: interpret
// @test-skip

export async function delayedHi(name: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 10));
  return "hi " + name;
}
