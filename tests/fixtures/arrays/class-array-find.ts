class User {
  name: string;
  active: boolean;
  constructor(name: string, active: boolean) {
    this.name = name;
    this.active = active;
  }
}

const users: User[] = [new User("alice", true), new User("bob", false), new User("charlie", true)];
const found = users.find((u: User): boolean => u.name === "bob");

if (found.name === "bob" && found.active === false) {
  console.log("TEST_PASSED");
}
