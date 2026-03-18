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

// Sunrise/sunset calculation (simplified NOAA solar calculator)
function calcSunTimes(lat, lon, date) {
  var rad = Math.PI / 180;
  var JD = Math.floor(date.getTime() / 86400000) + 2440587.5;
  var n = JD - 2451545.0;
  var L = (280.46 + 0.9856474 * n) % 360;
  var g = ((357.528 + 0.9856003 * n) % 360) * rad;
  var lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  var eps = 23.439 * rad - 0.0000004 * rad * n;
  var sinDec = Math.sin(eps) * Math.sin(lambda);
  var decl = Math.asin(sinDec);
  var cosHA =
    (Math.cos(90.833 * rad) - Math.sin(lat * rad) * sinDec) /
    (Math.cos(lat * rad) * Math.cos(decl));
  if (cosHA > 1 || cosHA < -1) return { sunrise: new Date(date), sunset: new Date(date) };
  var HA = Math.acos(cosHA) / rad;
  // Equation of time
  var y = Math.tan(eps / 2);
  y = y * y;
  var Lrad = L * rad;
  var eqTime =
    (4 *
      (y * Math.sin(2 * Lrad) -
        2 * 0.01671 * Math.sin(g) +
        4 * 0.01671 * y * Math.sin(g) * Math.cos(2 * Lrad))) /
    rad;
  var solarNoon = 720 - 4 * lon - eqTime;
  var tzOff = -date.getTimezoneOffset();
  var riseMin = solarNoon - 4 * HA + tzOff;
  var setMin = solarNoon + 4 * HA + tzOff;
  function minsToDate(mins) {
    var d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setMinutes(Math.round(mins));
    return d;
  }
  return { sunrise: minsToDate(riseMin), sunset: minsToDate(setMin) };
}

function setWeatherBg(forecast, isDaytime) {
  var f = forecast.toLowerCase();
  var bg;
  var showFlare = false;
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
    showFlare = isDaytime;
  }
  document.body.style.background = bg;
  var flare = document.getElementById("flare");
  if (showFlare) {
    flare.classList.add("active");
  } else {
    flare.classList.remove("active");
  }
}

function dirToDeg(dir) {
  var dirs = {
    N: 0,
    NNE: 22.5,
    NE: 45,
    ENE: 67.5,
    E: 90,
    ESE: 112.5,
    SE: 135,
    SSE: 157.5,
    S: 180,
    SSW: 202.5,
    SW: 225,
    WSW: 247.5,
    W: 270,
    WNW: 292.5,
    NW: 315,
    NNW: 337.5,
  };
  return dirs[dir] !== undefined ? dirs[dir] : 0;
}

function windCompassSvg(dir, speed) {
  var deg = dirToDeg(dir);
  var r = 44;
  var cx = 50;
  var cy = 50;
  var svg = '<svg viewBox="0 0 100 100" class="wind-compass">';
  // Inner circle (subtle)
  svg +=
    '<circle cx="' +
    cx +
    '" cy="' +
    cy +
    '" r="22" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>';
  // Outer ring — many fine ticks
  for (var ti = 0; ti < 360; ti += 6) {
    var tRad = ((ti - 90) * Math.PI) / 180;
    var isCardinal = ti % 90 === 0;
    var isMajor = ti % 30 === 0;
    var outer = r;
    var inner = isCardinal ? r - 8 : isMajor ? r - 5 : r - 3;
    var col = isCardinal ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.25)";
    var sw = isCardinal ? "2" : "1";
    svg +=
      '<line x1="' +
      (cx + inner * Math.cos(tRad)).toFixed(1) +
      '" y1="' +
      (cy + inner * Math.sin(tRad)).toFixed(1) +
      '" x2="' +
      (cx + outer * Math.cos(tRad)).toFixed(1) +
      '" y2="' +
      (cy + outer * Math.sin(tRad)).toFixed(1) +
      '" stroke="' +
      col +
      '" stroke-width="' +
      sw +
      '"/>';
  }
  // Cardinal labels outside the ring
  svg +=
    '<text x="50" y="4" text-anchor="middle" fill="#fff" font-size="10" font-weight="700">N</text>';
  svg +=
    '<text x="98" y="54" text-anchor="end" fill="rgba(255,255,255,0.6)" font-size="9" font-weight="600">E</text>';
  svg +=
    '<text x="50" y="99" text-anchor="middle" fill="rgba(255,255,255,0.6)" font-size="9" font-weight="600">S</text>';
  svg +=
    '<text x="2" y="54" text-anchor="start" fill="rgba(255,255,255,0.6)" font-size="9" font-weight="600">W</text>';
  // Speed in center
  var spdNum = parseInt(speed) || speed;
  svg +=
    '<text x="50" y="48" text-anchor="middle" fill="#fff" font-size="16" font-weight="300">' +
    spdNum +
    "</text>";
  svg +=
    '<text x="50" y="60" text-anchor="middle" fill="rgba(255,255,255,0.5)" font-size="7">mph</text>';
  // Direction arrow — thick with filled arrowhead
  var aRad = ((deg - 90) * Math.PI) / 180;
  var tipR = r - 3;
  var tipX = cx + tipR * Math.cos(aRad);
  var tipY = cy + tipR * Math.sin(aRad);
  // Arrowhead triangle
  var hLen = 10;
  var hAng = 0.35;
  var h1x = tipX - hLen * Math.cos(aRad - hAng);
  var h1y = tipY - hLen * Math.sin(aRad - hAng);
  var h2x = tipX - hLen * Math.cos(aRad + hAng);
  var h2y = tipY - hLen * Math.sin(aRad + hAng);
  svg +=
    '<polygon points="' +
    tipX.toFixed(1) +
    "," +
    tipY.toFixed(1) +
    " " +
    h1x.toFixed(1) +
    "," +
    h1y.toFixed(1) +
    " " +
    h2x.toFixed(1) +
    "," +
    h2y.toFixed(1) +
    '" fill="#fff"/>';
  // Tail — thin line opposite direction with dot at end
  var tailR = 18;
  var tailX = cx - tailR * Math.cos(aRad);
  var tailY = cy - tailR * Math.sin(aRad);
  svg +=
    '<line x1="' +
    cx +
    '" y1="' +
    cy +
    '" x2="' +
    tailX.toFixed(1) +
    '" y2="' +
    tailY.toFixed(1) +
    '" stroke="rgba(255,255,255,0.5)" stroke-width="2" stroke-linecap="round"/>';
  svg +=
    '<circle cx="' +
    tailX.toFixed(1) +
    '" cy="' +
    tailY.toFixed(1) +
    '" r="4" fill="rgba(255,255,255,0.7)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>';
  svg += "</svg>";
  return svg;
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
      if (!city) {
        var rl = p.relativeLocation.properties;
        city = rl.city + ", " + rl.state;
      }
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

function geocodeAndFetch(query) {
  errorEl.textContent = "";
  heroEl.innerHTML = '<div class="loading">Looking up location...</div>';
  hourlyEl.innerHTML = "";
  dailyEl.innerHTML = "";
  dashEl.innerHTML = "";
  searchBtn.disabled = true;

  var isZip = /^\d{5}$/.test(query.trim());
  var url = isZip
    ? "https://nominatim.openstreetmap.org/search?postalcode=" +
      encodeURIComponent(query) +
      "&country=US&format=json&limit=1&addressdetails=1"
    : "https://nominatim.openstreetmap.org/search?q=" +
      encodeURIComponent(query) +
      "&countrycodes=us&format=json&limit=1&addressdetails=1";

  fetch(url)
    .then(function (res) {
      if (!res.ok) throw new Error("fail");
      return res.json();
    })
    .then(function (results) {
      if (!results || results.length === 0) throw new Error("No match");
      var r = results[0];
      var ad = r.address || {};
      var cityName = ad.city || ad.town || ad.village || r.display_name.split(",")[0].trim();
      var state = ad.state || "";
      var stateAbbr = state.length > 2 ? state.substring(0, 2).toUpperCase() : state;
      var label = stateAbbr ? cityName + ", " + stateAbbr : cityName;
      history.replaceState(null, "", "?zip=" + encodeURIComponent(query));
      fetchWeather(r.lat, r.lon, label);
    })
    .catch(function () {
      searchBtn.disabled = false;
      showError('Could not find "' + query + '". Try a city name or US ZIP code.');
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
  // Sun arc — semicircle above horizon (day), dip below (night)
  // Layout: x 10-90, horizon at y=50, arc peaks at y=15, dips to y=65
  var dayLen = sunTimes.sunset - sunTimes.sunrise;
  var midnightToday = new Date(nowTime);
  midnightToday.setHours(0, 0, 0, 0);
  var fullDay = 24 * 60 * 60 * 1000;
  var dayFrac = (nowTime - midnightToday) / fullDay;
  var riseFrac = (sunTimes.sunrise - midnightToday) / fullDay;
  var setFrac = (sunTimes.sunset - midnightToday) / fullDay;
  var horizY = 28;
  var amp = 16;
  function sunPt(frac) {
    var phase = ((frac - riseFrac) / (setFrac - riseFrac)) * Math.PI;
    return { x: 5 + frac * 90, y: horizY - Math.sin(phase) * amp };
  }
  // Full curve (dim) — all 24 hours
  var fullPts = [];
  for (var ci = 0; ci <= 80; ci++) {
    var cp = sunPt(ci / 80);
    fullPts.push(cp.x.toFixed(1) + "," + cp.y.toFixed(1));
  }
  var fullD = "M " + fullPts.join(" L ");
  // Above-horizon only (bold) — just the daytime portion
  var boldPts = [];
  for (var bi = 0; bi <= 80; bi++) {
    var bf = bi / 80;
    var bp = sunPt(bf);
    if (bp.y <= horizY) boldPts.push(bp.x.toFixed(1) + "," + bp.y.toFixed(1));
  }
  var boldD = boldPts.length > 1 ? "M " + boldPts.join(" L ") : "";
  var sp = sunPt(dayFrac);
  var aboveHorizon = sp.y < horizY;
  var arcSvg =
    '<svg viewBox="0 0 100 48" class="sun-arc">' +
    '<path d="' +
    fullD +
    '" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1.5"/>' +
    (boldD
      ? '<path d="' + boldD + '" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2"/>'
      : "") +
    '<line x1="5" y1="' +
    horizY +
    '" x2="95" y2="' +
    horizY +
    '" stroke="rgba(255,255,255,0.2)" stroke-width="0.5"/>' +
    '<circle cx="' +
    sp.x.toFixed(1) +
    '" cy="' +
    sp.y.toFixed(1) +
    '" r="3.5" fill="' +
    (aboveHorizon ? "#fff" : "rgba(200,200,220,0.5)") +
    '"/>' +
    (aboveHorizon
      ? '<circle cx="' +
        sp.x.toFixed(1) +
        '" cy="' +
        sp.y.toFixed(1) +
        '" r="6" fill="rgba(255,255,255,0.15)"/>'
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

  // Wind with compass
  cards +=
    '<div class="dash-card glass"><div class="dash-title">\uD83D\uDCA8 Wind</div>' +
    '<div class="dash-value">' +
    now.windSpeed +
    "</div>" +
    windCompassSvg(now.windDirection, now.windSpeed) +
    "</div>";

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

// Typeahead
var sugEl = document.getElementById("suggestions");
var locateBtn = document.getElementById("locate");
var searchTimer = null;

function doSearch() {
  sugEl.innerHTML = "";
  sugEl.classList.remove("active");
  var z = zipInput.value.trim();
  if (z) geocodeAndFetch(z);
}

function showSuggestions(results) {
  sugEl.innerHTML = "";
  if (!results || results.length === 0) {
    sugEl.classList.remove("active");
    return;
  }
  for (var i = 0; i < Math.min(results.length, 5); i++) {
    var r = results[i];
    var ad = r.address || {};
    var sCity = ad.city || ad.town || ad.village || r.display_name.split(",")[0].trim();
    var sState = ad.state || "";
    var sLabel = sState ? sCity + ", " + sState : sCity;
    var div = document.createElement("div");
    div.className = "suggestion-item";
    div.innerHTML =
      '<span class="sug-city">' +
      sCity +
      '</span><span class="sug-region">' +
      (sState || "") +
      "</span>";
    div.setAttribute("data-lat", r.lat);
    div.setAttribute("data-lon", r.lon);
    div.setAttribute("data-name", sLabel);
    div.addEventListener("click", function () {
      var lat = this.getAttribute("data-lat");
      var lon = this.getAttribute("data-lon");
      var name = this.getAttribute("data-name");
      zipInput.value = name;
      sugEl.classList.remove("active");
      fetchWeather(lat, lon, name);
    });
    sugEl.appendChild(div);
  }
  sugEl.classList.add("active");
}

zipInput.addEventListener("input", function () {
  clearTimeout(searchTimer);
  var q = zipInput.value.trim();
  if (q.length < 3) {
    sugEl.classList.remove("active");
    return;
  }
  searchTimer = setTimeout(function () {
    var url =
      "https://nominatim.openstreetmap.org/search?q=" +
      encodeURIComponent(q) +
      "&countrycodes=us&format=json&limit=5&addressdetails=1";
    fetch(url, { headers: { Accept: "application/json" } })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (zipInput.value.trim() === q) showSuggestions(data);
      })
      .catch(function () {});
  }, 400);
});

zipInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    e.preventDefault();
    doSearch();
  }
});

document.addEventListener("click", function (e) {
  if (!e.target.closest(".search-wrap")) sugEl.classList.remove("active");
});

searchBtn.addEventListener("click", doSearch);

// Geolocation
locateBtn.addEventListener("click", function () {
  if (!navigator.geolocation) {
    showError("Geolocation not supported");
    return;
  }
  heroEl.innerHTML = '<div class="loading">Getting location...</div>';
  navigator.geolocation.getCurrentPosition(
    function (pos) {
      var lat = pos.coords.latitude.toFixed(4);
      var lon = pos.coords.longitude.toFixed(4);
      fetchWeather(lat, lon, null);
    },
    function () {
      showError("Could not get your location. Try searching instead.");
    },
  );
});

var params = new URLSearchParams(window.location.search);
var urlZip = params.get("zip");
if (urlZip) {
  zipInput.value = urlZip;
  geocodeAndFetch(urlZip);
} else {
  fetchWeather(defaultLat, defaultLon, defaultCity);
}
