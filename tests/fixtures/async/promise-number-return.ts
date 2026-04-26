async function getNum(): Promise<number> {
  return 42;
}

async function getBool(): Promise<boolean> {
  return true;
}

async function getStr(): Promise<string> {
  return "hello";
}

async function main(): Promise<void> {
  const n = await getNum();
  const b = await getBool();
  const s = await getStr();
  if (n === 42 && b === true && s === "hello") {
    console.log("TEST_PASSED");
  }
}

main();
