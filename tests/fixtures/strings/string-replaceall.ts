function testReplaceAll(): void {
  const s = "hello world hello world";
  const result = s.replaceAll("hello", "goodbye");
  if (result !== "goodbye world goodbye world") {
    console.log("Error: replaceAll failed");
    process.exit(1);
  }

  const s2 = "aaa";
  const result2 = s2.replaceAll("a", "bb");
  if (result2 !== "bbbbbb") {
    console.log("Error: replaceAll single char failed");
    process.exit(1);
  }

  const s3 = "no match here";
  const result3 = s3.replaceAll("xyz", "abc");
  if (result3 !== "no match here") {
    console.log("Error: replaceAll with no match should return original");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testReplaceAll();
