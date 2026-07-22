function checkAge(age: number): string {
  if (age < 0) {
    throw new Error("age cannot be negative");
  }
  return age < 18 ? "minor" : "adult";
}
console.log(checkAge(25));
console.log(checkAge(10));
console.log(checkAge(-5));
console.log("unreachable");
