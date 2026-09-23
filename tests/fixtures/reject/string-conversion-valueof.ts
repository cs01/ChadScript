// @expect-reject: CS1238
class Money {
  cents: number = 150;
  valueOf(): number {
    return this.cents;
  }
}
console.log("total " + new Money());
