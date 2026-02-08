interface Simple {
  name: string;
}

const arr: Simple[] = [];
const obj: Simple = { name: "test" };
arr.push(obj);

const length = arr.length;
console.log("Length: " + length);
