class Config {
  host: string;
  port: number;
  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
  }
}

function getConfig(flag: boolean): Config | null {
  if (flag) {
    return new Config("localhost", 8080);
  }
  return null;
}

const config = getConfig(true) ?? new Config("default", 3000);
console.log(config.host);
console.log(config.port);

const fallback = getConfig(false) ?? new Config("default", 3000);
console.log(fallback.host);
console.log(fallback.port);
