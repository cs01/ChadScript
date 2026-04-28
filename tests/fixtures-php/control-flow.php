<?php
function classify(int $n): int {
    if ($n > 0) {
        return 1;
    } elseif ($n < 0) {
        return -1;
    } else {
        return 0;
    }
}

echo classify(42);
echo classify(-7);
echo classify(0);

$total = 0;
for ($i = 0; $i < 10; $i++) {
    $total = $total + $i;
}
echo $total;

$count = 0;
$n = 1;
while ($n < 100) {
    $n = $n * 2;
    $count = $count + 1;
}
echo $count;
echo $n;
