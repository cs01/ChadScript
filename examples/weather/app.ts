import { ArgumentParser } from "chadscript/argparse";
import { httpServe } from "chadscript/http";
import { Router, Context } from "chadscript/http";

const parser = new ArgumentParser("weather", "Weather app powered by weather.gov");
parser.addOption("port", "p", "Port to listen on", "3000");
parser.parse(process.argv);

const port = parseInt(parser.getOption("port"));

ChadScript.embedDir("./public");

const app: Router = new Router();

function handleRequest(req: HttpRequest): HttpResponse {
  if (req.path === "/") {
    return ChadScript.serveEmbedded("index.html");
  }
  const res = app.handle(req);
  if (res.status !== 404) {
    return res;
  }
  return ChadScript.serveEmbedded(req.path);
}

console.log("Weather App");
console.log("  listening on http://localhost:" + port);

httpServe(port, handleRequest);
