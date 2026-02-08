interface Simple {
  name: string;
}

const arr: Simple[] = [];
const obj: Simple = { name: "test" };
arr.push(obj);

const first = arr[0];
const name = first.name;
console.log("Name: " + name);
