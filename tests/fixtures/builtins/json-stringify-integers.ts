interface Item {
  name: string;
  count: number;
  ratio: number;
}

function test(): void {
  const item: Item = { name: "test", count: 42, ratio: 3.14 };
  const json = JSON.stringify(item);
  if (json !== '{"name":"test","count":42,"ratio":3.14}') {
    console.log("FAIL: " + json);
    return;
  }

  const arr = [1, 2, 3];
  const arrJson = JSON.stringify(arr);
  if (arrJson !== "[1,2,3]") {
    console.log("FAIL array: " + arrJson);
    return;
  }

  console.log("TEST_PASSED");
}
test();
