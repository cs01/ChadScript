function getInfo(obj: any): string {
  const name: string = obj.name;
  const age: number = obj.age;
  return name + " is " + String(age);
}

const person = { name: "Alice", age: 30 };
console.log(getInfo(person));

function getNestedProp(data: any): string {
  const inner: any = data.child;
  const val: string = inner.label;
  return val;
}

const nested = { child: { label: "found" } };
console.log(getNestedProp(nested));
