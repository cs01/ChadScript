function testJSONParse() {
  // Test object
  const obj = JSON.parse('{"name":"Alice","age":30}');
  console.log(obj.name); // Alice
  console.log(obj.age); // 30

  // Test array
  const arr = JSON.parse("[1,2,3]");
  console.log(arr[0]); // 1
  console.log(arr[1]); // 2
  console.log(arr[2]); // 3

  // Test nested structure
  const nested = JSON.parse('{"user":{"name":"Bob","scores":[10,20,30]}}');
  console.log(nested.user.name); // Bob
  console.log(nested.user.scores[0]); // 10
  console.log(nested.user.scores[2]); // 30

  console.log("All JSON.parse tests passed!");
  return 0;
}

process.exit(testJSONParse());
