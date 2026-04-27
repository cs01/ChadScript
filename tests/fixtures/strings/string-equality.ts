function greet(name: string): string {
  if (name === "world") return "Hello, world!";
  if (name === "chad") return "What's up, chad!";
  return "Hi, " + name;
}

console.log(greet("world"));
console.log(greet("chad"));
console.log(greet("bob"));
