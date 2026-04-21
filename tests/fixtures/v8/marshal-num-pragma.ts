// @chadscript: interpret
// @test-skip

export function parseMs(s: string): number {
  return Number(require("ms")(s));
}
