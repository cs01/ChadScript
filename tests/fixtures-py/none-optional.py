from typing import Optional


def lookup(d: dict[str, int], key: str) -> int:
    return d.get(key, -1)


scores: dict[str, int] = {"alice": 95, "bob": 87}
print(lookup(scores, "alice"))
print(lookup(scores, "dave"))


class Node:
    val: int

    def __init__(self, v: int) -> None:
        self.val = v


def make_node(x: int) -> Node:
    return Node(x)


n: Node = make_node(42)
if n is not None:
    print(n.val)
