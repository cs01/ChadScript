<?php
function fib(int $n): int {
    if ($n <= 1) {
        return $n;
    }
    return fib($n - 1) + fib($n - 2);
}

echo fib(10);
echo fib(20);
echo fib(30);
