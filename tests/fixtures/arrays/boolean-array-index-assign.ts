const flags: boolean[] = [false, false, false, false];
flags[0] = true;
flags[2] = true;
if (flags[0] === true && flags[1] === false && flags[2] === true && flags[3] === false) {
  console.log("TEST_PASSED");
}
