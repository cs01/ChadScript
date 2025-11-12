function test(a) {
function test(score) {
  // Nested ternary: 
  // score >= 90 ? "A" : (score >= 80 ? "B" : "C")
  // For score 85: returns "B" which we'll convert to length (1)
  const grade = score >= 90 ? 10 : (score >= 80 ? 20 : 30);
  return grade;
}

process.exit(test(85));
