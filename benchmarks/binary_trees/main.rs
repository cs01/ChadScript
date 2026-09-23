// Binary trees: the same program as main.ts. Boxed nodes freed on drop (no GC), which is the
// allocation-and-free ceiling a collector is measured against.
struct TreeNode {
    left: Option<Box<TreeNode>>,
    right: Option<Box<TreeNode>>,
}

fn bottom_up(depth: u32) -> Box<TreeNode> {
    if depth == 0 {
        return Box::new(TreeNode { left: None, right: None });
    }
    Box::new(TreeNode {
        left: Some(bottom_up(depth - 1)),
        right: Some(bottom_up(depth - 1)),
    })
}

fn item_check(node: &TreeNode) -> f64 {
    match (&node.left, &node.right) {
        (Some(l), Some(r)) => 1.0 + item_check(l) + item_check(r),
        _ => 1.0,
    }
}

fn main() {
    let min_depth = 4;
    let max_depth = 16;
    let stretch = max_depth + 1;
    println!(
        "stretch tree of depth {}\t check: {}",
        stretch,
        item_check(&bottom_up(stretch))
    );
    let long_lived = bottom_up(max_depth);
    let mut depth = min_depth;
    while depth <= max_depth {
        let iterations: u64 = 1 << (max_depth - depth + min_depth);
        let mut check = 0.0;
        for _ in 0..iterations {
            check += item_check(&bottom_up(depth));
        }
        println!("{}\t trees of depth {}\t check: {}", iterations, depth, check);
        depth += 2;
    }
    println!(
        "long lived tree of depth {}\t check: {}",
        max_depth,
        item_check(&long_lived)
    );
}
