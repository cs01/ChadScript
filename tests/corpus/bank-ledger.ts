// @category: errors
// A bank ledger with custom error classes, validation, transfers that roll back on failure, and
// a transaction log written to disk.
import { writeFileSync } from "node:fs";

class BankError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BankError";
  }
}

class InsufficientFunds extends BankError {
  constructor(
    readonly account: string,
    readonly needed: number,
  ) {
    super(`account ${account} is short by ${needed.toFixed(2)}`);
    this.name = "InsufficientFunds";
  }
}

class UnknownAccount extends BankError {
  constructor(id: string) {
    super(`no such account: ${id}`);
    this.name = "UnknownAccount";
  }
}

interface Txn {
  kind: "deposit" | "withdraw" | "transfer";
  from?: string;
  to?: string;
  amount: number;
  ok: boolean;
  note: string;
}

class Bank {
  private balances = new Map<string, number>();
  readonly log: Txn[] = [];

  open(id: string, initial = 0): void {
    if (this.balances.has(id)) throw new BankError(`account ${id} already exists`);
    this.balances.set(id, initial);
  }

  balance(id: string): number {
    const b = this.balances.get(id);
    if (b === undefined) throw new UnknownAccount(id);
    return b;
  }

  deposit(id: string, amount: number): void {
    if (!(amount > 0)) throw new RangeError(`invalid amount ${amount}`);
    this.balances.set(id, this.balance(id) + amount);
  }

  withdraw(id: string, amount: number): void {
    const b = this.balance(id);
    if (amount > b) throw new InsufficientFunds(id, amount - b);
    this.balances.set(id, b - amount);
  }

  transfer(from: string, to: string, amount: number): void {
    this.withdraw(from, amount);
    try {
      this.deposit(to, amount);
    } catch (e) {
      this.deposit(from, amount); // roll back
      throw e;
    }
  }

  run(txn: Omit<Txn, "ok" | "note">): void {
    try {
      if (txn.kind === "deposit") this.deposit(txn.to!, txn.amount);
      else if (txn.kind === "withdraw") this.withdraw(txn.from!, txn.amount);
      else this.transfer(txn.from!, txn.to!, txn.amount);
      this.log.push({ ...txn, ok: true, note: "" });
    } catch (e) {
      if (!(e instanceof Error)) throw e;
      this.log.push({ ...txn, ok: false, note: `${e.name}: ${e.message}` });
    }
  }

  statement(): string {
    return [...this.balances].map(([id, b]) => `${id}=${b.toFixed(2)}`).join(" ");
  }
}

const bank = new Bank();
bank.open("alice", 100);
bank.open("bob", 20);
bank.open("carol");
try {
  bank.open("bob");
} catch (e) {
  console.log((e as Error).message);
}

bank.run({ kind: "deposit", to: "carol", amount: 55.5 });
bank.run({ kind: "withdraw", from: "bob", amount: 25 });
bank.run({ kind: "transfer", from: "alice", to: "bob", amount: 60 });
bank.run({ kind: "transfer", from: "alice", to: "dave", amount: 10 });
bank.run({ kind: "deposit", to: "alice", amount: -5 });
bank.run({ kind: "transfer", from: "carol", to: "alice", amount: 55.5 });

for (const t of bank.log) {
  console.log(`${t.ok ? "OK  " : "FAIL"} ${t.kind} ${t.amount}${t.note ? ` (${t.note})` : ""}`);
}
console.log(bank.statement());
writeFileSync("ledger.json", JSON.stringify(bank.log, null, 2));

const failures = bank.log.filter((t) => !t.ok).length;
if (failures > 2) {
  throw new BankError(`${failures} transactions failed`);
}
