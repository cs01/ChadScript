interface Bank {
  balance: number;
}
function deposit(acct: Bank, amt: number): void {
  acct.balance += amt;
}
function withdraw(acct: Bank, amt: number): void {
  acct.balance -= amt;
}
const acct: Bank = { balance: 100 };
deposit(acct, 50);
withdraw(acct, 30);
console.log(acct.balance);
