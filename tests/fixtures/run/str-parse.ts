function countWords(text: string): number {
  return text.split(" ").length;
}
console.log(countWords("the quick brown fox"));
const nums = "10,20,30,40";
let sum = 0;
for (const part of nums.split(",")) {
  sum += part.length;
}
console.log(sum);
