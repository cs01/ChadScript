interface User {
  name: string;
  age: number;
  active: boolean;
}

const users: User[] = [
  { name: "alice", age: 30, active: true },
  { name: "bob", age: 25, active: false },
  { name: "charlie", age: 35, active: true },
  { name: "diana", age: 28, active: true },
  { name: "eve", age: 22, active: false },
];

const activeUsers = users.filter((u: User) => u.active);
if (activeUsers.length !== 3) process.exit(1);

const names: string[] = [];
for (let i = 0; i < activeUsers.length; i++) {
  names.push(activeUsers[i].name);
}
if (names[0] !== "alice") process.exit(1);
if (names[1] !== "charlie") process.exit(1);
if (names[2] !== "diana") process.exit(1);

const ages: number[] = [];
users.forEach((u: User) => {
  ages.push(u.age);
});
if (ages.length !== 5) process.exit(1);
if (ages[0] !== 30) process.exit(1);

const hasYoung = users.some((u: User) => u.age < 25);
if (!hasYoung) process.exit(1);

const allAdult = users.every((u: User) => u.age >= 18);
if (!allAdult) process.exit(1);

const found = users.find((u: User) => u.name === "charlie");
if (found === null) process.exit(1);
if (found.age !== 35) process.exit(1);

console.log("TEST_PASSED");
