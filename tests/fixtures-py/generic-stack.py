class Stack:
    data: list[int]
    size: int

    def __init__(self) -> None:
        self.data = [0]
        self.size = 0

    def push(self, val: int) -> None:
        self.data.append(val)
        self.size += 1

    def pop(self) -> int:
        self.size -= 1
        n: int = len(self.data) - 1
        return self.data[n]

    def peek(self) -> int:
        n: int = len(self.data) - 1
        return self.data[n]

    def depth(self) -> int:
        return self.size


s: Stack = Stack()
s.push(10)
s.push(20)
s.push(30)
print(s.depth())
print(s.peek())
print(s.pop())
print(s.depth())
print(s.pop())
