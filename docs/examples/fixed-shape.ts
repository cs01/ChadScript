interface User {
  name: string;
  email?: string | undefined;
}

const user: User = { name: "ada", email: undefined };
user.email = "ada@example.com";
console.log(user);
