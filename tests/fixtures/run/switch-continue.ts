for (let i = 0; i < 5; i++) {
  switch (i % 2) {
    case 0:
      continue;
    default:
      console.log(i);
  }
}
