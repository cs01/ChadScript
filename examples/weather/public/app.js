var heroEl = document.getElementById("hero");
var hourlyEl = document.getElementById("hourly");
var dailyEl = document.getElementById("daily");
var dashEl = document.getElementById("dashboard");
var zipInput = document.getElementById("zip");
var searchBtn = document.getElementById("search");
var errorEl = document.getElementById("error");

var defaultLat = "37.7849";
var defaultLon = "-122.4094";
var defaultCity = "San Francisco";

var icons = {
  Sunny: "\u2600\uFE0F",
  Clear: "\u2600\uFE0F",
  "Mostly Sunny": "\uD83C\uDF24\uFE0F",
  "Mostly Clear": "\uD83C\uDF19",
  "Partly Sunny": "\u26C5",
  "Partly Cloudy": "\u26C5",
  "Mostly Cloudy": "\uD83C\uDF25\uFE0F",
  Cloudy: "\u2601\uFE0F",
  "Slight Chance Rain Showers": "\uD83C\uDF26\uFE0F",
  "Chance Rain Showers": "\uD83C\uDF26\uFE0F",
  "Rain Showers Likely": "\uD83C\uDF27\uFE0F",
  Rain: "\uD83C\uDF27\uFE0F",
  "Light Rain": "\uD83C\uDF27\uFE0F",
  "Heavy Rain": "\uD83C\uDF27\uFE0F",
  Showers: "\uD83C\uDF27\uFE0F",
  Thunderstorms: "\u26C8\uFE0F",
  Snow: "\uD83C\uDF28\uFE0F",
  "Light Snow": "\uD83C\uDF28\uFE0F",
  "Heavy Snow": "\uD83C\uDF28\uFE0F",
  Fog: "\uD83C\uDF2B\uFE0F",
  Windy: "\uD83D\uDCA8",
};

function icon(forecast, daytime) {
  for (var k in icons) {
    if (forecast.indexOf(k) !== -1) return icons[k];
  }
  return daytime ? "\u2600\uFE0F" : "\uD83C\uDF19";
}

function cToF(c) {
  return Math.round((c * 9) / 5 + 32);
}

function fmtHour(iso) {
  var d = new Date(iso);
  var h = d.getHours();
  if (h === 0) return "12AM";
  if (h < 12) return h + "AM";
  if (h === 12) return "12PM";
  return h - 12 + "PM";
}

function showError(msg) {
  heroEl.innerHTML = "";
  hourlyEl.innerHTML = "";
  dailyEl.innerHTML = "";
  dashEl.innerHTML = "";
  errorEl.innerHTML = '<div class="error-msg">' + msg + "</div>";
}

function fetchWeather(lat, lon, city) {
  heroEl.innerHTML = '<div class="loading">Loading...</div>';
  hourlyEl.innerHTML = "";
  dailyEl.innerHTML = "";
  dashEl.innerHTML = "";
  errorEl.textContent = "";
  searchBtn.disabled = true;

  var gridUrl = "";

  fetch("https://api.weather.gov/points/" + lat + "," + lon)
    .then(function (res) {
      if (!res.ok) throw new Error("Location not found");
      return res.json();
    })
    .then(function (points) {
      var p = points.properties;
      if (!city) city = p.relativeLocation.properties.city;
      gridUrl = "https://api.weather.gov/gridpoints/" + p.gridId + "/" + p.gridX + "," + p.gridY;
      return Promise.all([
        fetch(p.forecast).then(function (r) {
          return r.json();
        }),
        fetch(p.forecast + "/hourly").then(function (r) {
          return r.json();
        }),
        fetch(gridUrl).then(function (r) {
          return r.ok ? r.json() : null;
        }),
      ]);
    })
    .then(function (results) {
      searchBtn.disabled = false;
      render(city, results[0], results[1], results[2]);
    })
    .catch(function () {
      searchBtn.disabled = false;
      showError("Could not load weather data");
    });
}

function geocodeAndFetch(zip) {
  errorEl.textContent = "";
  heroEl.innerHTML = '<div class="loading">Looking up location...</div>';
  hourlyEl.innerHTML = "";
  dailyEl.innerHTML = "";
  dashEl.innerHTML = "";
  searchBtn.disabled = true;

  var url =
    "https://nominatim.openstreetmap.org/search?postalcode=" +
    encodeURIComponent(zip) +
    "&country=US&format=json&limit=1";

  fetch(url)
    .then(function (res) {
      if (!res.ok) throw new Error("fail");
      return res.json();
    })
    .then(function (results) {
      if (!results || results.length === 0) throw new Error("No match");
      var parts = results[0].display_name.split(",");
      var city = parts.length > 2 ? parts[1].trim() : parts[0].trim();
      history.replaceState(null, "", "?zip=" + encodeURIComponent(zip));
      fetchWeather(results[0].lat, results[0].lon, city);
    })
    .catch(function () {
      searchBtn.disabled = false;
      showError('Could not find "' + zip + '". Try a US ZIP like 94102 or 10001.');
    });
}

function getGridVal(grid, field) {
  if (!grid || !grid.properties || !grid.properties[field]) return null;
  var v = grid.properties[field].values;
  if (!v || v.length === 0) return null;
  return v[0].value;
}

function render(city, forecast, hourlyData, grid) {
  var periods = forecast.properties.periods;
  if (!periods || periods.length === 0) {
    showError("No forecast data");
    return;
  }

  var now = periods[0];
  var tonight = periods.length > 1 && !periods[1].isDaytime ? periods[1] : null;
  var hi = now.isDaytime ? now.temperature : tonight ? periods[2].temperature : now.temperature;
  var lo = tonight ? tonight.temperature : now.temperature;

  heroEl.innerHTML =
    '<div class="hero-section">' +
    '<div class="hero-city">' +
    city +
    "</div>" +
    '<div class="hero-temp">' +
    now.temperature +
    "\u00B0</div>" +
    '<div class="hero-condition">' +
    now.shortForecast +
    "</div>" +
    '<div class="hero-hilo">H:' +
    hi +
    "\u00B0  L:" +
    lo +
    "\u00B0</div>" +
    "</div>";

  // Hourly
  var hrs = hourlyData.properties.periods;
  var hHtml =
    '<div class="hourly-card glass"><div class="hourly-label">' +
    now.detailedForecast.substring(0, 80) +
    '</div><div class="hourly-scroll">';
  var hCount = Math.min(hrs.length, 24);
  for (var i = 0; i < hCount; i++) {
    var h = hrs[i];
    var label = i === 0 ? "Now" : fmtHour(h.startTime);
    hHtml +=
      '<div class="hourly-item">' +
      '<div class="hourly-time">' +
      label +
      "</div>" +
      '<div class="hourly-icon">' +
      icon(h.shortForecast, h.isDaytime) +
      "</div>" +
      '<div class="hourly-temp">' +
      h.temperature +
      "\u00B0</div></div>";
  }
  hHtml += "</div></div>";
  hourlyEl.innerHTML = hHtml;

  // Daily
  var days = [];
  var allLo = 999;
  var allHi = -999;
  for (var di = 0; di < periods.length; di++) {
    var dp = periods[di];
    if (dp.isDaytime) {
      var nightP = di + 1 < periods.length && !periods[di + 1].isDaytime ? periods[di + 1] : null;
      var dayLo = nightP ? nightP.temperature : dp.temperature - 15;
      days.push({
        name: dp.name.substring(0, 3),
        hi: dp.temperature,
        lo: dayLo,
        forecast: dp.shortForecast,
      });
      if (dp.temperature > allHi) allHi = dp.temperature;
      if (dayLo < allLo) allLo = dayLo;
    }
  }

  var range = allHi - allLo || 1;
  var dHtml =
    '<div class="daily-card glass"><div class="daily-label">\uD83D\uDCC5 ' +
    days.length +
    "-Day Forecast</div>";
  for (var j = 0; j < days.length; j++) {
    var d = days[j];
    var barLeft = ((d.lo - allLo) / range) * 100;
    var barWidth = ((d.hi - d.lo) / range) * 100;
    if (barWidth < 8) barWidth = 8;
    dHtml +=
      '<div class="daily-row">' +
      '<div class="daily-name">' +
      d.name +
      "</div>" +
      '<div class="daily-icon">' +
      icon(d.forecast, true) +
      "</div>" +
      '<div class="daily-low">' +
      d.lo +
      "\u00B0</div>" +
      '<div class="daily-bar-wrap"><div class="daily-bar" style="left:' +
      barLeft +
      "%;width:" +
      barWidth +
      '%"></div></div>' +
      '<div class="daily-high">' +
      d.hi +
      "\u00B0</div></div>";
  }
  dHtml += "</div>";
  dailyEl.innerHTML = dHtml;

  // Dashboard cards
  var feelsLike = getGridVal(grid, "apparentTemperature");
  var humidity = getGridVal(grid, "relativeHumidity");
  var dewpoint = getGridVal(grid, "dewpoint");
  var visibility = getGridVal(grid, "visibility");
  var precip = now.probabilityOfPrecipitation ? now.probabilityOfPrecipitation.value : null;

  var cards = "";
  cards +=
    '<div class="dash-card glass"><div class="dash-title">\uD83D\uDCA8 Wind</div>' +
    '<div class="dash-value">' +
    now.windSpeed +
    "</div>" +
    '<div class="dash-detail">' +
    now.windDirection +
    "</div></div>";

  if (feelsLike !== null) {
    cards +=
      '<div class="dash-card glass"><div class="dash-title">\uD83C\uDF21\uFE0F Feels Like</div>' +
      '<div class="dash-value">' +
      cToF(feelsLike) +
      "\u00B0</div>" +
      '<div class="dash-detail">Based on humidity and wind</div></div>';
  }

  if (humidity !== null) {
    cards +=
      '<div class="dash-card glass"><div class="dash-title">\uD83D\uDCA7 Humidity</div>' +
      '<div class="dash-value">' +
      Math.round(humidity) +
      '<span class="dash-unit">%</span></div>';
    if (dewpoint !== null) {
      cards += '<div class="dash-detail">Dew point is ' + cToF(dewpoint) + "\u00B0F</div>";
    }
    cards += "</div>";
  }

  cards +=
    '<div class="dash-card glass"><div class="dash-title">\u2614 Precipitation</div>' +
    '<div class="dash-value">' +
    (precip || 0) +
    '<span class="dash-unit">%</span></div>' +
    '<div class="dash-detail">Chance today</div></div>';

  if (visibility !== null) {
    var visMi = Math.round(visibility / 1609);
    cards +=
      '<div class="dash-card glass"><div class="dash-title">\uD83D\uDC41\uFE0F Visibility</div>' +
      '<div class="dash-value">' +
      visMi +
      '<span class="dash-unit"> mi</span></div>' +
      '<div class="dash-detail">' +
      (visMi >= 10 ? "Clear view" : visMi >= 5 ? "Moderate" : "Low visibility") +
      "</div></div>";
  }

  if (dewpoint !== null && feelsLike === null) {
    cards +=
      '<div class="dash-card glass"><div class="dash-title">\uD83C\uDF21\uFE0F Dew Point</div>' +
      '<div class="dash-value">' +
      cToF(dewpoint) +
      "\u00B0</div></div>";
  }

  dashEl.innerHTML = cards;
}

searchBtn.addEventListener("click", function () {
  var z = zipInput.value.trim();
  if (z) geocodeAndFetch(z);
});

zipInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    var z = zipInput.value.trim();
    if (z) geocodeAndFetch(z);
  }
});

// Check URL for ?zip= parameter
var params = new URLSearchParams(window.location.search);
var urlZip = params.get("zip");
if (urlZip) {
  zipInput.value = urlZip;
  geocodeAndFetch(urlZip);
} else {
  fetchWeather(defaultLat, defaultLon, defaultCity);
}
