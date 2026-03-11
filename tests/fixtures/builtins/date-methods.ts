function testDateMethods(): void {
  const now: Date = new Date();

  const hours: number = now.getHours();
  if (hours < 0 || hours > 23) {
    console.log("FAIL: hours out of range: " + hours);
    process.exit(1);
  }

  const minutes: number = now.getMinutes();
  if (minutes < 0 || minutes > 59) {
    console.log("FAIL: minutes out of range: " + minutes);
    process.exit(1);
  }

  const seconds: number = now.getSeconds();
  if (seconds < 0 || seconds > 59) {
    console.log("FAIL: seconds out of range: " + seconds);
    process.exit(1);
  }

  const date: number = now.getDate();
  if (date < 1 || date > 31) {
    console.log("FAIL: date out of range: " + date);
    process.exit(1);
  }

  const time: number = now.getTime();
  if (time < 1000000000000) {
    console.log("FAIL: getTime too small: " + time);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testDateMethods();
