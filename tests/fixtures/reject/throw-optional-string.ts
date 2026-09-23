// @expect-reject: CS1247
function fail(msg: string | undefined): void {
  throw msg;
}
fail("x");
