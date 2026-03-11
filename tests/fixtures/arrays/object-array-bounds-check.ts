// @test-exit-code: 1
interface Item {
  name: string;
}
const arr: Item[] = [{ name: "a" }, { name: "b" }];
const x = arr[5];
console.log(x.name);
