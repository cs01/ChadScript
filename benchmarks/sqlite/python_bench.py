import sqlite3
import time

db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)")
for i in range(100):
    db.execute(f"INSERT INTO t VALUES ({i}, 'value_{i}')")
db.commit()

iterations = 100000
start = time.perf_counter()

for j in range(iterations):
    id_ = j % 100
    db.execute(f"SELECT val FROM t WHERE id = {id_}").fetchone()

end = time.perf_counter()
elapsed = end - start
qps = int(iterations / elapsed)
print(f"Queries:  {iterations}")
print(f"Time:     {elapsed:.3f}s")
print(f"QPS:      {qps}")

db.close()
