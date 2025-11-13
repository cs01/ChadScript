function testJSONParse() {
  // Test array
  const arr = JSON.parse("[1,2,3]");
  console.log(arr[0]); // 1
  console.log(arr[1]); // 2
  console.log(arr[2]); // 3

  console.log("JSON.parse array test passed!");
  return 0;
}

process.exit(testJSONParse());
