function testArrayJoin(): void {
  const words: string[] = ["hello", "world", "test"];
  const joined: string = words.join(" ");
  if (joined !== "hello world test") {
    console.log("FAIL: join with space got '" + joined + "'");
    process.exit(1);
  }

  const csv: string = words.join(",");
  if (csv !== "hello,world,test") {
    console.log("FAIL: join with comma got '" + csv + "'");
    process.exit(1);
  }

  const empty: string[] = [];
  const emptyJoin: string = empty.join(",");
  if (emptyJoin !== "") {
    console.log("FAIL: empty join should be empty, got '" + emptyJoin + "'");
    process.exit(1);
  }

  const single: string[] = ["only"];
  const singleJoin: string = single.join(",");
  if (singleJoin !== "only") {
    console.log("FAIL: single join got '" + singleJoin + "'");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testArrayJoin();
