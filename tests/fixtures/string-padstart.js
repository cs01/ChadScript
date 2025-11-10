function test() {
  let num = "5";
  let result = num.padStart(3, "0");
  console.log(result);
  return result.length;
}

test();
