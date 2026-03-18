import { ArgumentParser } from "chadscript/argparse";
import { httpServe } from "chadscript/http";
import { Router, Context } from "chadscript/http";

const parser = new ArgumentParser("weather", "Weather app powered by weather.gov");
parser.addOption("port", "p", "Port to listen on", "3000");
parser.parse(process.argv);

const port = parseInt(parser.getOption("port"));

ChadScript.embedDir("./public");

interface PointsResponse {
  properties: PointsProperties;
}

interface PointsProperties {
  forecast: string;
  relativeLocation: RelativeLocation;
}

interface RelativeLocation {
  properties: LocationProperties;
}

interface LocationProperties {
  city: string;
  state: string;
}

interface ForecastResponse {
  properties: ForecastProperties;
}

interface ForecastProperties {
  periods: ForecastPeriod[];
}

interface ForecastPeriod {
  number: number;
  name: string;
  temperature: number;
  temperatureUnit: string;
  windSpeed: string;
  windDirection: string;
  shortForecast: string;
  detailedForecast: string;
  isDaytime: boolean;
}

interface WeatherResult {
  city: string;
  state: string;
  periods: ForecastPeriod[];
}

interface GeoResult {
  result: GeoResultInner;
}

interface GeoResultInner {
  addressMatches: AddressMatch[];
}

interface AddressMatch {
  coordinates: GeoCoordinates;
}

interface GeoCoordinates {
  x: number;
  y: number;
}

interface ErrorResponse {
  error: string;
}

async function getWeather(lat: string, lon: string): Promise<string> {
  const pointsUrl = "https://api.weather.gov/points/" + lat + "," + lon;
  const pointsRes = await fetch(pointsUrl);
  if (!pointsRes.ok) {
    const err: ErrorResponse = { error: "Could not find weather data for this location" };
    return JSON.stringify(err);
  }

  const points = pointsRes.json<PointsResponse>();
  const forecastUrl = points.properties.forecast;
  const city = points.properties.relativeLocation.properties.city;
  const state = points.properties.relativeLocation.properties.state;

  const forecastRes = await fetch(forecastUrl);
  if (!forecastRes.ok) {
    const err: ErrorResponse = { error: "Could not fetch forecast" };
    return JSON.stringify(err);
  }

  const forecast = forecastRes.json<ForecastResponse>();
  const result: WeatherResult = {
    city: city,
    state: state,
    periods: forecast.properties.periods,
  };
  return JSON.stringify(result);
}

async function geocodeZip(zip: string): Promise<string> {
  const url =
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=" +
    encodeURIComponent(zip) +
    "&benchmark=Public_AR_Current&format=json";
  const res = await fetch(url);
  if (!res.ok) {
    return "";
  }
  const data = res.json<GeoResult>();
  if (data.result.addressMatches.length === 0) {
    return "";
  }
  const coords = data.result.addressMatches[0].coordinates;
  const lat = "" + coords.y;
  const lon = "" + coords.x;
  return lat + "," + lon;
}

function handleApiWeather(c: Context): HttpResponse {
  const lat = c.req.param("lat");
  const lon = c.req.param("lon");
  const result = getWeather(lat, lon);
  return c.header("Cache-Control", "max-age=900").json(result);
}

function handleApiGeocode(c: Context): HttpResponse {
  const zip = c.req.param("zip");
  const coords = geocodeZip(zip);
  if (coords === "") {
    return c.status(404).json('{"error":"ZIP code not found"}');
  }
  const parts = coords.split(",");
  return c.json('{"lat":' + parts[0] + ',"lon":' + parts[1] + "}");
}

const app: Router = new Router();
app.get("/api/weather/:lat/:lon", handleApiWeather);
app.get("/api/geocode/:zip", handleApiGeocode);

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
console.log("");

httpServe(port, handleRequest);
