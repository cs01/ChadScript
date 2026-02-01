interface User {
  name: string;
  age: number;
}

const users: Map<string, User> = new Map();

const alice: User = { name: "Alice", age: 30 };
const bob: User = { name: "Bob", age: 25 };

users.set("alice", alice);
users.set("bob", bob);

const found = users.get("alice");
console.log(found.name);
