export class Greeter {
    constructor(name) {
        this.name = name;
    }
    
    greet() {
        console.log("Hello");
    }
}

const g = new Greeter("World");
process.exit(g.greet());
