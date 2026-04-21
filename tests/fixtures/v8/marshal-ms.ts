// @chadscript: interpret
// @test-skip

export function ms(s: string): string {
  return String(require("ms")(s));
}
