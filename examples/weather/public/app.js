var locationEl = document.getElementById("location");
var currentEl = document.getElementById("current");
var forecastEl = document.getElementById("forecast");
var zipInput = document.getElementById("zip");
var searchBtn = document.getElementById("search");
var errorEl = document.getElementById("error");

var defaultLat = "37.7849";
var defaultLon = "-122.4094";

var weatherIcons = {
  Sunny: "\u2600\uFE0F",
  Clear: "\u2600\uFE0F",
  "Mostly Sunny": "\u26C5",
  "Mostly Clear": "\u2600\uFE0F",
  "Partly Sunny": "\u26C5",
  "Partly Cloudy": "\u26C5",
  "Mostly Cloudy": "\u2601\uFE0F",
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
  Haze: "\uD83C\uDF2B\uFE0F",
  Windy: "\uD83D\uDCA8",
  Hot: "\uD83E\uDD75",
  Cold: "\uD83E\uDD76",
};

function getIcon(shortForecast, isDaytime) {
  for (var key in weatherIcons) {
    if (shortForecast.indexOf(key) !== -1) return weatherIcons[key];
  }
  return isDaytime ? "\u2600\uFE0F" : "\uD83C\uDF19";
}

function fetchWeather(lat, lon, displayName) {
  locationEl.textContent = "";
  currentEl.innerHTML = '<div class="loading">Loading forecast...</div>';
  forecastEl.innerHTML = "";
  errorEl.textContent = "";
  searchBtn.disabled = true;

  var gridUrl = "";

  fetch("https://api.weather.gov/points/" + lat + "," + lon)
    .then(function (res) {
      if (!res.ok) throw new Error("Location not found");
      return res.json();
    })
    .then(function (points) {
      var props = points.properties;
      if (displayName) {
        locationEl.innerHTML = "<strong>" + displayName + "</strong>";
      } else {
        var loc = props.relativeLocation.properties;
        locationEl.innerHTML = "<strong>" + loc.city + "</strong>, " + loc.state;
      }
      gridUrl =
        "https://api.weather.gov/gridpoints/" +
        props.gridId +
        "/" +
        props.gridX +
        "," +
        props.gridY;
      return fetch(props.forecast);
    })
    .then(function (res) {
      if (!res.ok) throw new Error("Forecast unavailable");
      return res.json();
    })
    .then(function (forecast) {
      var periods = forecast.properties.periods;
      return fetch(gridUrl).then(function (gridRes) {
        var gridData = null;
        if (gridRes.ok) {
          return gridRes.json().then(function (gd) {
            gridData = gd;
            searchBtn.disabled = false;
            renderWeather(periods, gridData);
          });
        } else {
          searchBtn.disabled = false;
          renderWeather(periods, null);
        }
      });
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
      var name = results[0].display_name.split(",")[0];
      fetchWeather(results[0].lat, results[0].lon, name);
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

function getGridValue(gridData, field) {
  if (!gridData || !gridData.properties || !gridData.properties[field]) return null;
  var vals = gridData.properties[field].values;
  if (!vals || vals.length === 0) return null;
  return vals[0].value;
}

function cToF(c) {
  return Math.round((c * 9) / 5 + 32);
}

function renderWeather(periods, gridData) {
  if (!periods || periods.length === 0) {
    showError("No forecast data available");
    return;
  }

  var now = periods[0];
  var tonight = periods.length > 1 ? periods[1] : null;
  var icon = getIcon(now.shortForecast, now.isDaytime);
  var tempClass = now.temperature >= 70 ? "warm" : "cool";

  var humidity = getGridValue(gridData, "relativeHumidity");
  var dewpoint = getGridValue(gridData, "dewpoint");
  var feelsLike = getGridValue(gridData, "apparentTemperature");
  var precip = now.probabilityOfPrecipitation ? now.probabilityOfPrecipitation.value : null;

  var hiLo = "";
  if (now.isDaytime && tonight) {
    hiLo = "High " + now.temperature + "\u00B0 \u00B7 Low " + tonight.temperature + "\u00B0";
  } else if (!now.isDaytime && periods.length > 2) {
    hiLo = "Low " + now.temperature + "\u00B0 \u00B7 High " + periods[2].temperature + "\u00B0";
  }

  var heroHtml =
    '<div class="hero">' +
    '<div class="hero-left">' +
    '<div class="hero-icon">' +
    icon +
    "</div>" +
    '<div class="hero-temp ' +
    tempClass +
    '">' +
    now.temperature +
    '<span class="degree">\u00B0' +
    now.temperatureUnit +
    "</span></div>" +
    "</div>" +
    '<div class="hero-right">' +
    '<div class="hero-condition">' +
    now.shortForecast +
    "</div>" +
    (hiLo ? '<div class="hero-hilo">' + hiLo + "</div>" : "") +
    (feelsLike !== null
      ? '<div class="hero-feels">Feels like ' + cToF(feelsLike) + "\u00B0</div>"
      : "") +
    "</div>" +
    "</div>";

  var detailHtml = '<div class="detail-grid">';
  detailHtml +=
    '<div class="detail-item"><span class="detail-label">\u{1F4A8} Wind</span><span class="detail-value">' +
    now.windSpeed +
    " " +
    now.windDirection +
    "</span></div>";
  if (humidity !== null) {
    detailHtml +=
      '<div class="detail-item"><span class="detail-label">\u{1F4A7} Humidity</span><span class="detail-value">' +
      Math.round(humidity) +
      "%</span></div>";
  }
  if (dewpoint !== null) {
    detailHtml +=
      '<div class="detail-item"><span class="detail-label">\u{1F321}\uFE0F Dew Point</span><span class="detail-value">' +
      cToF(dewpoint) +
      "\u00B0F</span></div>";
  }
  if (precip !== null && precip !== undefined) {
    detailHtml +=
      '<div class="detail-item"><span class="detail-label">\u2614 Precipitation</span><span class="detail-value">' +
      (precip || 0) +
      "%</span></div>";
  }
  detailHtml += "</div>";

  currentEl.innerHTML = heroHtml + detailHtml;

  var forecastHtml = "";
  var dayIndex = now.isDaytime ? 2 : 1;
  var dayCount = 0;
  while (dayIndex < periods.length && dayCount < 7) {
    var day = periods[dayIndex];
    if (!day.isDaytime) {
      dayIndex++;
      continue;
    }
    var night = dayIndex + 1 < periods.length ? periods[dayIndex + 1] : null;
    var dayIcon = getIcon(day.shortForecast, true);
    var tc = day.temperature >= 70 ? "warm" : "cool";
    forecastHtml +=
      '<div class="forecast-card">' +
      '<div class="fc-name">' +
      day.name +
      "</div>" +
      '<div class="fc-icon">' +
      dayIcon +
      "</div>" +
      '<div class="fc-temp ' +
      tc +
      '">' +
      day.temperature +
      "\u00B0</div>" +
      (night ? '<div class="fc-low">' + night.temperature + "\u00B0</div>" : "") +
      '<div class="fc-desc">' +
      day.shortForecast +
      "</div>" +
      "</div>";
    dayIndex += 2;
    dayCount++;
  }
  forecastEl.innerHTML = forecastHtml;
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

fetchWeather(defaultLat, defaultLon, "San Francisco, CA");
