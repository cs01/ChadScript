class Score {
  name: string;
  points: number;
  constructor(name: string, points: number) {
    this.name = name;
    this.points = points;
  }
}

function main(): void {
  const scores: Score[] = [];
  scores.push(new Score("alice", 90));
  scores.push(new Score("bob", 40));
  scores.push(new Score("carol", 85));
  scores.push(new Score("dave", 30));

  const passing: Score[] = scores.filter((s: Score): boolean => s.points >= 50);
  let names = "";
  for (const p of passing) {
    names = names + p.name + ",";
  }

  if (names === "alice,carol,") {
    console.log("TEST_PASSED");
  }
}

main();
