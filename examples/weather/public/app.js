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
var currentLat = defaultLat;
var currentLon = defaultLon;

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

function fmtTime(date) {
  var h = date.getHours();
  var m = date.getMinutes();
  var ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return h + ":" + (m < 10 ? "0" : "") + m + " " + ampm;
}

// Sunrise/sunset calculation (NOAA algorithm)
function calcSunTimes(lat, lon, date) {
  var rad = Math.PI / 180;
  var dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
  var tzOffset = -date.getTimezoneOffset() / 60;

  var fracYear = ((2 * Math.PI) / 365) * (dayOfYear - 1);
  var eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(fracYear) -
      0.032077 * Math.sin(fracYear) -
      0.014615 * Math.cos(2 * fracYear) -
      0.040849 * Math.sin(2 * fracYear));
  var decl =
    0.006918 -
    0.399912 * Math.cos(fracYear) +
    0.070257 * Math.sin(fracYear) -
    0.006758 * Math.cos(2 * fracYear) +
    0.000907 * Math.sin(2 * fracYear) -
    0.002697 * Math.cos(3 * fracYear) +
    0.00148 * Math.sin(3 * fracYear);

  var ha =
    Math.acos(
      Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) -
        Math.tan(lat * rad) * Math.tan(decl),
    ) / rad;

  var sunrise = 720 - 4 * (lon + ha) - eqTime + tzOffset * 60;
  var sunset = 720 - 4 * (lon - ha) - eqTime + tzOffset * 60;

  function minsToDate(mins) {
    var d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setMinutes(Math.round(mins));
    return d;
  }

  return { sunrise: minsToDate(sunrise), sunset: minsToDate(sunset) };
}

function setWeatherBg(forecast, isDaytime) {
  var f = forecast.toLowerCase();
  var bg;
  if (!isDaytime) {
    bg = "linear-gradient(180deg, #0a1628 0%, #1a1a3e 40%, #0d0d1f 100%)";
  } else if (f.indexOf("rain") !== -1 || f.indexOf("shower") !== -1) {
    bg = "linear-gradient(180deg, #374151 0%, #1f2937 40%, #111827 100%)";
  } else if (f.indexOf("snow") !== -1) {
    bg = "linear-gradient(180deg, #64748b 0%, #475569 40%, #334155 100%)";
  } else if (f.indexOf("cloud") !== -1 || f.indexOf("overcast") !== -1) {
    bg = "linear-gradient(180deg, #3b5e8a 0%, #2d4a6f 40%, #1a3050 100%)";
  } else if (f.indexOf("fog") !== -1 || f.indexOf("haze") !== -1) {
    bg = "linear-gradient(180deg, #6b7b8d 0%, #4a5568 40%, #2d3748 100%)";
  } else {
    bg = "linear-gradient(180deg, #3a7bd5 0%, #1a5276 40%, #0f2b44 100%)";
  }
  document.body.style.background = bg;
}

function showError(msg) {
  heroEl.innerHTML = "";
  hourlyEl.innerHTML = "";
  dailyEl.innerHTML = "";
  dashEl.innerHTML = "";
  errorEl.innerHTML = '<div class="error-msg">' + msg + "</div>";
}

function fetchWeather(lat, lon, city) {
  currentLat = lat;
  currentLon = lon;
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
  var now = new Date();
  for (var i = 0; i < v.length; i++) {
    var parts = v[i].validTime.split("/");
    var start = new Date(parts[0]);
    if (start > now) return i > 0 ? v[i - 1].value : v[0].value;
  }
  return v[v.length - 1].value;
}

function render(city, forecast, hourlyData, grid) {
  var periods = forecast.properties.periods;
  if (!periods || periods.length === 0) {
    showError("No forecast data");
    return;
  }

  var now = periods[0];
  var tonight = periods.length > 1 && !periods[1].isDaytime ? periods[1] : null;
  var hi = now.isDaytime
    ? now.temperature
    : tonight && periods.length > 2
      ? periods[2].temperature
      : now.temperature;
  var lo = tonight ? tonight.temperature : now.temperature;

  var hrs = hourlyData.properties.periods;
  var currentTemp = hrs.length > 0 ? hrs[0].temperature : now.temperature;

  setWeatherBg(now.shortForecast, now.isDaytime);

  var feelsLike = getGridVal(grid, "apparentTemperature");
  var feelsHtml =
    feelsLike !== null
      ? '<div class="hero-feels">Feels Like: ' + cToF(feelsLike) + "\u00B0</div>"
      : "";

  heroEl.innerHTML =
    '<div class="hero-section">' +
    '<div class="hero-city">' +
    city +
    "</div>" +
    '<div class="hero-temp">' +
    currentTemp +
    "\u00B0</div>" +
    feelsHtml +
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
  var humidity = getGridVal(grid, "relativeHumidity");
  var dewpoint = getGridVal(grid, "dewpoint");
  var visibility = getGridVal(grid, "visibility");
  var precip = now.probabilityOfPrecipitation ? now.probabilityOfPrecipitation.value : null;

  var cards = "";

  // Sunrise/Sunset card
  var sunTimes = calcSunTimes(parseFloat(currentLat), parseFloat(currentLon), new Date());
  var nowTime = new Date();
  var isBeforeSunset = nowTime < sunTimes.sunset;
  var sunLabel = isBeforeSunset ? "Sunset" : "Sunrise";
  var sunValue = isBeforeSunset ? fmtTime(sunTimes.sunset) : fmtTime(sunTimes.sunrise);
  var sunDetail = isBeforeSunset
    ? "Sunrise: " + fmtTime(sunTimes.sunrise)
    : "Sunset: " + fmtTime(sunTimes.sunset);
  // Sun arc — full sinusoidal curve, above horizon = day, below = night
  var dayLen = sunTimes.sunset - sunTimes.sunrise;
  var midnightToday = new Date(nowTime);
  midnightToday.setHours(0, 0, 0, 0);
  var fullDay = 24 * 60 * 60 * 1000;
  var dayProgress = (nowTime - midnightToday) / fullDay;
  var riseFrac = (sunTimes.sunrise - midnightToday) / fullDay;
  var setFrac = (sunTimes.sunset - midnightToday) / fullDay;
  var hY = 40;
  var amp = 28;
  var sinPoints = [];
  for (var si = 0; si <= 60; si++) {
    var frac = si / 60;
    var px = 5 + frac * 90;
    var phase = ((frac - riseFrac) / (setFrac - riseFrac)) * Math.PI;
    var py = hY - Math.sin(phase) * amp;
    sinPoints.push(px.toFixed(1) + "," + py.toFixed(1));
  }
  var pathD = "M " + sinPoints.join(" L ");
  var sunPhase = ((dayProgress - riseFrac) / (setFrac - riseFrac)) * Math.PI;
  var sunX = 5 + dayProgress * 90;
  var sunY = hY - Math.sin(sunPhase) * amp;
  var aboveHorizon = sunY < hY;
  var progPts = [];
  for (var pi = 0; pi <= 60; pi++) {
    var pf = pi / 60;
    if (pf > dayProgress) break;
    var ppx = 5 + pf * 90;
    var pp = ((pf - riseFrac) / (setFrac - riseFrac)) * Math.PI;
    var ppy = hY - Math.sin(pp) * amp;
    progPts.push(ppx.toFixed(1) + "," + ppy.toFixed(1));
  }
  var progD = progPts.length > 1 ? "M " + progPts.join(" L ") : "";
  var arcSvg =
    '<svg viewBox="0 0 100 80" class="sun-arc">' +
    '<path d="' +
    pathD +
    '" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>' +
    (progD ? '<path d="' + progD + '" fill="none" stroke="#ffcc00" stroke-width="2"/>' : "") +
    '<line x1="5" y1="' +
    hY +
    '" x2="95" y2="' +
    hY +
    '" stroke="rgba(255,255,255,0.2)" stroke-width="0.5" stroke-dasharray="2,2"/>' +
    '<circle cx="' +
    sunX.toFixed(1) +
    '" cy="' +
    sunY.toFixed(1) +
    '" r="3.5" fill="' +
    (aboveHorizon ? "#ffcc00" : "rgba(255,255,255,0.4)") +
    '"/>' +
    (aboveHorizon
      ? '<circle cx="' +
        sunX.toFixed(1) +
        '" cy="' +
        sunY.toFixed(1) +
        '" r="6" fill="rgba(255,204,0,0.15)"/>'
      : "") +
    "</svg>";
  cards +=
    '<div class="dash-card glass"><div class="dash-title">\uD83C\uDF05 ' +
    sunLabel +
    "</div>" +
    '<div class="dash-value sun-time">' +
    sunValue +
    "</div>" +
    arcSvg +
    '<div class="dash-detail">' +
    sunDetail +
    "</div></div>";

  // Wind
  cards +=
    '<div class="dash-card glass"><div class="dash-title">\uD83D\uDCA8 Wind</div>' +
    '<div class="dash-value">' +
    now.windSpeed +
    "</div>" +
    '<div class="dash-detail">' +
    now.windDirection +
    "</div></div>";

  // Humidity
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

  // Precipitation
  cards +=
    '<div class="dash-card glass"><div class="dash-title">\u2614 Precipitation</div>' +
    '<div class="dash-value">' +
    (precip || 0) +
    '<span class="dash-unit">%</span></div>' +
    '<div class="dash-detail">Chance today</div></div>';

  // Visibility
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

  // Feels Like (as card if not in hero for some reason)
  if (feelsLike !== null) {
    cards +=
      '<div class="dash-card glass"><div class="dash-title">\uD83C\uDF21\uFE0F Feels Like</div>' +
      '<div class="dash-value">' +
      cToF(feelsLike) +
      "\u00B0</div>" +
      '<div class="dash-detail">Actual: ' +
      currentTemp +
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

var params = new URLSearchParams(window.location.search);
var urlZip = params.get("zip");
if (urlZip) {
  zipInput.value = urlZip;
  geocodeAndFetch(urlZip);
} else {
  fetchWeather(defaultLat, defaultLon, defaultCity);
}
