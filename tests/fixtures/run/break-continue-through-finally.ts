// break through finally
function f1(): string {
  let log = "";
  for (let i = 0; i < 5; i++) {
    try {
      if (i === 2) {
        break;
      }
      log += "body" + i + ";";
    } finally {
      log += "fin" + i + ";";
    }
  }
  return log;
}
// continue through finally
function f2(): string {
  let log = "";
  for (let i = 0; i < 3; i++) {
    try {
      if (i === 1) {
        continue;
      }
      log += "body" + i + ";";
    } finally {
      log += "fin" + i + ";";
    }
  }
  return log;
}
// nested finally + break out
function f3(): string {
  let log = "";
  for (let i = 0; i < 3; i++) {
    try {
      try {
        if (i === 1) {
          break;
        }
      } finally {
        log += "inner" + i + ";";
      }
    } finally {
      log += "outer" + i + ";";
    }
  }
  return log;
}
// break targeting a loop, with a nested loop inside try (break stays in nested loop)
function f4(): string {
  let log = "";
  for (let i = 0; i < 2; i++) {
    try {
      for (let j = 0; j < 3; j++) {
        if (j === 1) {
          break;
        }
        log += i + "-" + j + ";";
      }
    } finally {
      log += "fin" + i + ";";
    }
  }
  return log;
}
console.log(f1());
console.log(f2());
console.log(f3());
console.log(f4());
