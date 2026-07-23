struct Body {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    mass: f64,
}

fn step(bodies: &mut Vec<Body>, dt: f64) {
    let n = bodies.len();
    for i in 0..n {
        for j in 0..n {
            let dx = bodies[j].x - bodies[i].x;
            let dy = bodies[j].y - bodies[i].y;
            let d2 = dx * dx + dy * dy + 0.01;
            let inv = 1.0 / (d2 * d2.sqrt());
            let m = bodies[j].mass;
            bodies[i].vx += dx * m * inv * dt;
            bodies[i].vy += dy * m * inv * dt;
        }
    }
    for b in bodies.iter_mut() {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
    }
}

fn run(count: usize, steps: usize) -> f64 {
    let mut bodies: Vec<Body> = Vec::new();
    for i in 0..count {
        let f = (i + 1) as f64;
        bodies.push(Body {
            x: f % 17.0,
            y: f % 23.0,
            vx: 0.0,
            vy: 0.0,
            mass: 1.0 + (f % 3.0),
        });
    }
    for _ in 0..steps {
        step(&mut bodies, 0.01);
    }
    bodies.iter().map(|b| b.vx * b.vx + b.vy * b.vy).sum()
}

fn main() {
    println!("{}", run(600, 60));
}
