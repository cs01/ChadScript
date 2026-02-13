package main

import (
	"fmt"
	"math"
	"time"
)

const (
	PI           = 3.141592653589793
	SolarMass    = 4.0 * PI * PI
	DaysPerYear  = 365.24
	NBodies      = 5
	Steps        = 50000000
	DT           = 0.01
)

type Body struct {
	x, y, z, vx, vy, vz, mass float64
}

func advance(bodies []Body) {
	for i := 0; i < NBodies; i++ {
		for j := i + 1; j < NBodies; j++ {
			dx := bodies[i].x - bodies[j].x
			dy := bodies[i].y - bodies[j].y
			dz := bodies[i].z - bodies[j].z
			dist2 := dx*dx + dy*dy + dz*dz
			dist := math.Sqrt(dist2)
			mag := DT / (dist2 * dist)
			bodies[i].vx -= dx * bodies[j].mass * mag
			bodies[i].vy -= dy * bodies[j].mass * mag
			bodies[i].vz -= dz * bodies[j].mass * mag
			bodies[j].vx += dx * bodies[i].mass * mag
			bodies[j].vy += dy * bodies[i].mass * mag
			bodies[j].vz += dz * bodies[i].mass * mag
		}
	}
	for i := 0; i < NBodies; i++ {
		bodies[i].x += DT * bodies[i].vx
		bodies[i].y += DT * bodies[i].vy
		bodies[i].z += DT * bodies[i].vz
	}
}

func energy(bodies []Body) float64 {
	e := 0.0
	for i := 0; i < NBodies; i++ {
		e += 0.5 * bodies[i].mass * (bodies[i].vx*bodies[i].vx + bodies[i].vy*bodies[i].vy + bodies[i].vz*bodies[i].vz)
		for j := i + 1; j < NBodies; j++ {
			dx := bodies[i].x - bodies[j].x
			dy := bodies[i].y - bodies[j].y
			dz := bodies[i].z - bodies[j].z
			dist := math.Sqrt(dx*dx + dy*dy + dz*dz)
			e -= bodies[i].mass * bodies[j].mass / dist
		}
	}
	return e
}

func main() {
	bodies := []Body{
		{0, 0, 0, 0, 0, 0, SolarMass},
		{4.84143144246472090e+00, -1.16032004402742839e+00, -1.03622044471123109e-01,
			1.66007664274403694e-03 * DaysPerYear, 7.69901118419740425e-03 * DaysPerYear, -6.90460016972020000e-05 * DaysPerYear,
			9.54791938424326609e-04 * SolarMass},
		{8.34336671824457987e+00, 4.12479856412430479e+00, -4.03603533096309840e-01,
			-2.76742510726862411e-03 * DaysPerYear, 4.99852801234917238e-03 * DaysPerYear, 2.30417297573763890e-05 * DaysPerYear,
			2.85885980666130812e-04 * SolarMass},
		{1.28943695621391310e+01, -1.51111514016986340e+01, -2.23307578892655734e-01,
			2.96460137564761618e-03 * DaysPerYear, 2.37847173959480950e-03 * DaysPerYear, -2.96589568540237560e-04 * DaysPerYear,
			4.36624404335156298e-05 * SolarMass},
		{1.53796971148509165e+01, -2.59193146099879640e+01, 1.79258772950371181e-01,
			2.68067772490389322e-03 * DaysPerYear, 1.62824170038242295e-03 * DaysPerYear, -9.51592254519715870e-05 * DaysPerYear,
			5.15138902046611451e-05 * SolarMass},
	}

	px, py, pz := 0.0, 0.0, 0.0
	for i := 0; i < NBodies; i++ {
		px += bodies[i].vx * bodies[i].mass
		py += bodies[i].vy * bodies[i].mass
		pz += bodies[i].vz * bodies[i].mass
	}
	bodies[0].vx = -px / SolarMass
	bodies[0].vy = -py / SolarMass
	bodies[0].vz = -pz / SolarMass

	fmt.Printf("Energy:   %.9f\n", energy(bodies))

	start := time.Now()
	for i := 0; i < Steps; i++ {
		advance(bodies)
	}
	elapsed := time.Since(start).Seconds()

	fmt.Printf("Energy:   %.9f\n", energy(bodies))
	fmt.Printf("Steps:    %d\n", Steps)
	fmt.Printf("Time:     %.3fs\n", elapsed)
}
