// Client-side WebSocket chat logic.
// Connects to the server, sends/receives messages, auto-reconnects.

var messages = document.getElementById("messages");
var form = document.getElementById("form");
var input = document.getElementById("input");
var status = document.getElementById("status");
var ws;
var myConnId = null;

function addMessage(text, type) {
  var div = document.createElement("div");
  div.className = "message " + type;
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function connect() {
  status.textContent = "connecting...";
  status.className = "status";
  ws = new WebSocket("ws://" + location.host + "/ws");

  ws.onopen = function () {
    status.textContent = "connected";
    status.className = "status connected";
    addMessage("Connected to chat server", "system");
  };

  ws.onmessage = function (e) {
    var data = e.data;
    if (data.startsWith("init|")) {
      myConnId = data.slice(5);
      return;
    }
    if (data.startsWith("sys|")) {
      addMessage(data.slice(4), "system");
      return;
    }
    if (data.startsWith("msg|")) {
      var rest = data.slice(4);
      var sep = rest.indexOf("|");
      var sender = rest.slice(0, sep);
      var msg = rest.slice(sep + 1);
      addMessage(msg, sender === myConnId ? "sent" : "received");
      return;
    }
    addMessage(data, "received");
  };

  ws.onerror = function () {
    addMessage("Connection error", "system");
  };

  ws.onclose = function () {
    status.textContent = "disconnected";
    status.className = "status disconnected";
    addMessage("Disconnected — reconnecting...", "system");
    setTimeout(connect, 2000);
  };
}

form.onsubmit = function (e) {
  e.preventDefault();
  var msg = input.value.trim();
  if (msg.length > 0 && ws && ws.readyState === 1) {
    ws.send(msg);
    input.value = "";
  }
};

connect();
