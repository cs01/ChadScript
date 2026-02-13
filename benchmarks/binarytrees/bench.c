#include <stdio.h>
#include <stdlib.h>
#include <time.h>

#define MIN_DEPTH 4
#define MAX_DEPTH 18

typedef struct Node {
    struct Node *left;
    struct Node *right;
} Node;

Node *make_tree(int depth) {
    Node *n = (Node *)malloc(sizeof(Node));
    if (depth == 0) {
        n->left = NULL;
        n->right = NULL;
    } else {
        n->left = make_tree(depth - 1);
        n->right = make_tree(depth - 1);
    }
    return n;
}

int check_tree(Node *n) {
    if (n->left == NULL) return 1;
    return 1 + check_tree(n->left) + check_tree(n->right);
}

void free_tree(Node *n) {
    if (n->left) free_tree(n->left);
    if (n->right) free_tree(n->right);
    free(n);
}

int main(void) {
    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);

    int stretch_depth = MAX_DEPTH + 1;
    Node *stretch = make_tree(stretch_depth);
    printf("stretch: %d\n", check_tree(stretch));
    free_tree(stretch);

    Node *long_lived = make_tree(MAX_DEPTH);

    for (int depth = MIN_DEPTH; depth <= MAX_DEPTH; depth += 2) {
        int iterations = 1 << (MAX_DEPTH - depth + MIN_DEPTH);
        int check = 0;
        for (int i = 0; i < iterations; i++) {
            Node *t = make_tree(depth);
            check += check_tree(t);
            free_tree(t);
        }
        printf("depth %d check: %d\n", depth, check);
    }

    printf("long lived: %d\n", check_tree(long_lived));
    free_tree(long_lived);

    clock_gettime(CLOCK_MONOTONIC, &t1);
    double elapsed = (t1.tv_sec - t0.tv_sec) + (t1.tv_nsec - t0.tv_nsec) / 1e9;
    printf("Time:     %.3fs\n", elapsed);
    return 0;
}
