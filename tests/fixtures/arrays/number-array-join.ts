function test(): void {
  const arr = [1, 2, 3];
  const j1 = arr.join(", ");
  if (j1 !== "1, 2, 3") {
    console.log("FAIL comma: '" + j1 + "'");
    return;
  }

  const floats = [1.5, 2.7, 3.14];
  const j2 = floats.join("-");
  if (j2 !== "1.5-2.7-3.14") {
    console.log("FAIL floats: '" + j2 + "'");
    return;
  }

  const empty: number[] = [];
  const j3 = empty.join(",");
  if (j3 !== "") {
    console.log("FAIL empty: '" + j3 + "'");
    return;
  }

  const single = [42];
  const j4 = single.join(",");
  if (j4 !== "42") {
    console.log("FAIL single: '" + j4 + "'");
    return;
  }

  console.log("TEST_PASSED");
}
test();
