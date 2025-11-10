function test(a) {
  // Nested ternary operators to determine grade
  // 90+ = A (4), 80-89 = B (3), 70-79 = C (2), else = F (0)
  let grade = a >= 90 ? 4 : a >= 80 ? 3 : a >= 70 ? 2 : 0;

  return grade;
}

test(85);
