function color(name: string): string {
  switch (name) {
    case "r":
      return "red";
    case "g":
      return "green";
    case "b":
      return "blue";
    default:
      return "?";
  }
}
console.log(color("r"), color("g"), color("x"));
