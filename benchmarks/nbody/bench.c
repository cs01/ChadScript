#include <stdio.h>
#include <math.h>
#include <time.h>

#define PI 3.141592653589793
#define SOLAR_MASS (4.0 * PI * PI)
#define DAYS_PER_YEAR 365.24
#define N 5
#define STEPS 50000000

static double x[N], y[N], z[N];
static double vx[N], vy[N], vz[N];
static double mass[N];

static void init(void) {
    x[0]=0; y[0]=0; z[0]=0; vx[0]=0; vy[0]=0; vz[0]=0; mass[0]=SOLAR_MASS;

    x[1]=4.84143144246472090e+00; y[1]=-1.16032004402742839e+00; z[1]=-1.03622044471123109e-01;
    vx[1]=1.66007664274403694e-03*DAYS_PER_YEAR; vy[1]=7.69901118419740425e-03*DAYS_PER_YEAR; vz[1]=-6.90460016972063023e-05*DAYS_PER_YEAR;
    mass[1]=9.54791938424326609e-04*SOLAR_MASS;

    x[2]=8.34336671824457987e+00; y[2]=4.12479856412430479e+00; z[2]=-4.03523417114321381e-01;
    vx[2]=-2.76742510726862411e-03*DAYS_PER_YEAR; vy[2]=4.99852801234917238e-03*DAYS_PER_YEAR; vz[2]=2.30417297573763929e-05*DAYS_PER_YEAR;
    mass[2]=2.85885980666130812e-04*SOLAR_MASS;

    x[3]=1.28943695621391310e+01; y[3]=-1.51111514016986312e+01; z[3]=-2.23307578892655734e-01;
    vx[3]=2.96460137564761618e-03*DAYS_PER_YEAR; vy[3]=2.37847173959480950e-03*DAYS_PER_YEAR; vz[3]=-2.96589568540237556e-05*DAYS_PER_YEAR;
    mass[3]=4.36624404335156298e-05*SOLAR_MASS;

    x[4]=1.53796971148509165e+01; y[4]=-2.59193146099879641e+01; z[4]=1.79258772950371181e-01;
    vx[4]=2.68067772490389322e-03*DAYS_PER_YEAR; vy[4]=1.62824170038242295e-03*DAYS_PER_YEAR; vz[4]=-9.51592254519715870e-05*DAYS_PER_YEAR;
    mass[4]=5.15138902046611451e-05*SOLAR_MASS;

    double px=0, py=0, pz=0;
    for (int i=0; i<N; i++) { px+=vx[i]*mass[i]; py+=vy[i]*mass[i]; pz+=vz[i]*mass[i]; }
    vx[0]=-px/SOLAR_MASS; vy[0]=-py/SOLAR_MASS; vz[0]=-pz/SOLAR_MASS;
}

static double energy(void) {
    double e = 0;
    for (int i=0; i<N; i++) {
        e += 0.5 * mass[i] * (vx[i]*vx[i] + vy[i]*vy[i] + vz[i]*vz[i]);
        for (int j=i+1; j<N; j++) {
            double dx=x[i]-x[j], dy=y[i]-y[j], dz=z[i]-z[j];
            e -= mass[i]*mass[j] / sqrt(dx*dx + dy*dy + dz*dz);
        }
    }
    return e;
}

static void advance(double dt, int steps) {
    for (int s=0; s<steps; s++) {
        for (int i=0; i<N; i++) {
            for (int j=i+1; j<N; j++) {
                double dx=x[i]-x[j], dy=y[i]-y[j], dz=z[i]-z[j];
                double d2 = dx*dx + dy*dy + dz*dz;
                double mag = dt / (d2 * sqrt(d2));
                vx[i]-=dx*mass[j]*mag; vy[i]-=dy*mass[j]*mag; vz[i]-=dz*mass[j]*mag;
                vx[j]+=dx*mass[i]*mag; vy[j]+=dy*mass[i]*mag; vz[j]+=dz*mass[i]*mag;
            }
        }
        for (int i=0; i<N; i++) { x[i]+=dt*vx[i]; y[i]+=dt*vy[i]; z[i]+=dt*vz[i]; }
    }
}

int main(void) {
    init();
    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);
    advance(0.01, STEPS);
    clock_gettime(CLOCK_MONOTONIC, &t1);
    double elapsed = (t1.tv_sec-t0.tv_sec) + (t1.tv_nsec-t0.tv_nsec)/1e9;
    printf("Bodies:   %d\n", N);
    printf("Steps:    %d\n", STEPS);
    printf("Energy:   %.9f\n", energy());
    printf("Time:     %.3fs\n", elapsed);
    return 0;
}
