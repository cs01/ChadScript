import re

m = re.match(r'\d+', 'abc123')
print(m)

m = re.match(r'\d+', '123abc')
print(m.group())

m = re.search(r'\d+', 'abc123def')
print(m.group())

matches = re.findall(r'\d+', 'a1b2c3')
print(matches)

result = re.sub(r'\d+', 'X', 'a1b2c3')
print(result)

parts = re.split(r'\s+', 'hello world  foo')
print(parts)
