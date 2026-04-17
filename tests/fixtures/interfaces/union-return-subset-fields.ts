interface Big {
  a: number;
  b: number;
  c: number;
}

interface Small {
  a: number;
}

function pick(flag: boolean): Big | Small {
  if (flag) {
    return { a: 1, b: 2, c: 3 };
  }
  return { a: 7 };
}

function main(): void {
  const big = pick(true) as Big;
  const small = pick(false) as Small;
  if (big.a === 1 && big.b === 2 && big.c === 3 && small.a === 7) {
    console.log("TEST_PASSED");
  }
}

main();
