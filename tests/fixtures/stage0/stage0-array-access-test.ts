interface Decl {
  type: string;
  name: string;
}

const arr: Decl[] = [];
arr.push({ type: "foo", name: "x" });
arr.push({ type: "bar", name: "y" });

for (let i = 0; i < 2; i++) {
  const item = arr[i] as { type: string; name: string };
  console.log("type = " + item.type);
  console.log("name = " + item.name);
}
