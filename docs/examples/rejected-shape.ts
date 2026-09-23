// @expect-reject: CS1235
// #region show
interface User {
  name: string;
  email?: string;
}

const user: User = { name: "ada" };
user.email = "ada@example.com";
console.log(user);
// #endregion show
