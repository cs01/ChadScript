function dayName(d: number): string {
  let name: string = "unknown";
  switch (d) {
    case 1:
      name = "Monday";
      break;
    case 2:
      name = "Tuesday";
      break;
    case 3:
      name = "Wednesday";
      break;
    default:
      name = "other";
      break;
  }
  return name;
}

console.log(dayName(1));
console.log(dayName(2));
console.log(dayName(3));
console.log(dayName(7));
