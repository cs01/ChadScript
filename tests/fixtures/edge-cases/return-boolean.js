// @test-exit-code: 1
function test() {
  return true;
}

function test2() {
  return false;
}

process.exit(test());
