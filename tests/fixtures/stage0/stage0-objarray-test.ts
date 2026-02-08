interface Simple {
  name: string;
  value: number;
}

const arr: Simple[] = [];
arr.push({ name: "test", value: 42 });

const first = arr[0];
console.log("Array length: " + arr.length);
console.log("First name: " + first.name);
console.log("First value: " + first.value);
