scores: dict[str, int] = {"alice": 95, "bob": 87, "carol": 92}

print(scores.get("alice", 0))
print(scores.get("dave", 0))
print(scores.get("bob", 50))
