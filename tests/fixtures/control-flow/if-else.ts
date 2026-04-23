// @test-exit-code: 15
function max(a: number, b: number) {
  let result = 0;
  if (a > b) {
    result = a;
  } else {
    result = b;
  }
  return result;
}

process.exit(max(15, 10));
