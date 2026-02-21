function testDateInstance(): void {
  let epoch = new Date(0);
  if (epoch.getTime() !== 0) {
    console.log("FAIL: getTime: " + epoch.getTime().toString());
    process.exit(1);
  }

  // 2024-01-15T11:30:45Z = 1705318245000 ms
  let d = new Date(1705318245000);
  let year = d.getFullYear();
  if (year !== 2024) {
    console.log("FAIL: getFullYear: " + year.toString());
    process.exit(1);
  }

  let month = d.getMonth();
  if (month !== 0) {
    console.log("FAIL: getMonth: " + month.toString());
    process.exit(1);
  }

  let iso = d.toISOString();
  if (iso !== "2024-01-15T11:30:45Z") {
    console.log("FAIL: toISOString: " + iso);
    process.exit(1);
  }

  let now = new Date();
  let ms = now.getTime();
  if (ms < 1000000000000) {
    console.log("FAIL: now.getTime too small: " + ms.toString());
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testDateInstance();
