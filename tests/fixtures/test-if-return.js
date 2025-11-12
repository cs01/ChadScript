function run() {
  let x = 10;

  if (x > 5) {
    return 42;
  }

  return 0;
}

process.exit(run());
