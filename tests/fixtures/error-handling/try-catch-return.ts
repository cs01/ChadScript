function getValueReturnBoth(): string {
  try {
    return "success";
  } catch (e) {
    return "fail";
  }
}

function getValueReturnThrow(): string {
  try {
    return "success";
  } catch (e) {
    throw e;
  }
}

const r1 = getValueReturnBoth();
const r2 = getValueReturnThrow();
if (r1 === "success" && r2 === "success") {
  console.log("TEST_PASSED");
}
