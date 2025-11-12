function test(x) {
  if (x == 2) {
    return 1;
  }
function run() {
  let x = 10;
  
  if (x > 5) {
    return 42;
  }
  
  return 0;
}

process.exit(run());
