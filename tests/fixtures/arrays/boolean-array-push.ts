const flags: boolean[] = [];
flags.push(true);
flags.push(false);
flags.push(true);
if (flags.length === 3 && flags[0] === true && flags[1] === false) {
  console.log("TEST_PASSED");
}
