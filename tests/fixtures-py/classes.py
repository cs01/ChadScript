class Counter:
    value: int

    def __init__(self, start: int) -> None:
        self.value = start

    def increment(self) -> None:
        self.value += 1

    def decrement(self) -> None:
        self.value -= 1

    def get(self) -> int:
        return self.value


c: Counter = Counter(10)
c.increment()
c.increment()
c.increment()
print(c.get())
c.decrement()
print(c.get())


class Adder:
    offset: int

    def __init__(self, n: int) -> None:
        self.offset = n

    def add(self, x: int) -> int:
        return self.offset + x

    def mul(self, x: int) -> int:
        return self.offset * x


a: Adder = Adder(10)
print(a.add(5))
print(a.add(20))
print(a.mul(3))


class Stack:
    top: int
    size: int

    def __init__(self) -> None:
        self.top = 0
        self.size = 0

    def push(self, val: int) -> None:
        self.top = val
        self.size += 1

    def pop(self) -> int:
        self.size -= 1
        return self.top

    def depth(self) -> int:
        return self.size


s: Stack = Stack()
s.push(42)
s.push(99)
print(s.depth())
print(s.pop())
