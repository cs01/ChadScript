var locationEl = document.getElementById("location");
var currentEl = document.getElementById("current");
var forecastEl = document.getElementById("forecast");
var zipInput = document.getElementById("zip");
var searchBtn = document.getElementById("search");
var errorEl = document.getElementById("error");

var defaultLat = "37.7849";
var defaultLon = "-122.4094";

function fetchWeather(lat, lon) {
  locationEl.textContent = "";
  currentEl.innerHTML = '<div class="loading">Loading forecast...</div>';
  forecastEl.innerHTML = "";
  errorEl.textContent = "";
  searchBtn.disabled = true;

  fetch("https://api.weather.gov/points/" + lat + "," + lon)
    .then(function (res) {
      if (!res.ok) throw new Error("Location not found");
      return res.json();
    })
    .then(function (points) {
      var props = points.properties;
      var loc = props.relativeLocation.properties;
      locationEl.innerHTML = "<strong>" + loc.city + "</strong>, " + loc.state;
      return fetch(props.forecast);
    })
    .then(function (res) {
      if (!res.ok) throw new Error("Forecast unavailable");
      return res.json();
    })
    .then(function (forecast) {
      searchBtn.disabled = false;
      renderWeather(forecast.properties.periods);
    })
    .catch(function () {
      searchBtn.disabled = false;
      showError("Could not load weather data for this location");
    });
}

function geocodeAndFetch(zip) {
  errorEl.textContent = "";
  currentEl.innerHTML = '<div class="loading">Looking up location...</div>';
  forecastEl.innerHTML = "";
  searchBtn.disabled = true;

  var url =
    "https://nominatim.openstreetmap.org/search?postalcode=" +
    encodeURIComponent(zip) +
    "&country=US&format=json&limit=1";

  fetch(url)
    .then(function (res) {
      if (!res.ok) throw new Error("Geocoding failed");
      return res.json();
    })
    .then(function (results) {
      if (!results || results.length === 0) throw new Error("No match");
      fetchWeather(results[0].lat, results[0].lon);
    })
    .catch(function () {
      searchBtn.disabled = false;
      showError('Could not find ZIP code "' + zip + '". Try a US ZIP like 94102 or 10001.');
    });
}

function showError(msg) {
  currentEl.innerHTML = "";
  forecastEl.innerHTML = "";
  errorEl.innerHTML = '<div class="error-msg">' + msg + "</div>";
}

function renderWeather(periods) {
  if (!periods || periods.length === 0) {
    showError("No forecast data available");
    return;
  }

  var now = periods[0];
  var tempClass = now.temperature >= 70 ? "warm" : "cool";

  currentEl.innerHTML =
    '<div class="current">' +
    '<div class="current-temp ' +
    tempClass +
    '">' +
    now.temperature +
    "\u00B0" +
    now.temperatureUnit +
    "</div>" +
    '<div class="current-detail">' +
    '<div class="label">' +
    now.name +
    "</div>" +
    '<div class="wind">' +
    now.windSpeed +
    " " +
    now.windDirection +
    "</div>" +
    '<div class="desc">' +
    now.detailedForecast +
    "</div>" +
    "</div></div>";

  var html = "";
  for (var i = 1; i < periods.length && i < 9; i++) {
    var p = periods[i];
    var cls = p.isDaytime ? "" : " night";
    var tc = p.temperature >= 70 ? "warm" : "cool";
    html +=
      '<div class="forecast-card' +
      cls +
      '">' +
      '<div class="period-name">' +
      p.name +
      "</div>" +
      '<div class="temp ' +
      tc +
      '">' +
      p.temperature +
      "\u00B0</div>" +
      '<div class="wind">' +
      p.windSpeed +
      " " +
      p.windDirection +
      "</div>" +
      '<div class="short">' +
      p.shortForecast +
      "</div>" +
      "</div>";
  }
  forecastEl.innerHTML = html;
}

searchBtn.addEventListener("click", function () {
  var zip = zipInput.value.trim();
  if (zip) geocodeAndFetch(zip);
});

zipInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    var zip = zipInput.value.trim();
    if (zip) geocodeAndFetch(zip);
  }
});

fetchWeather(defaultLat, defaultLon);
