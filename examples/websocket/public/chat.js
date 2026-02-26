// Client-side WebSocket chat logic.
// Connects to the server, sends/receives messages, auto-reconnects.

var messages = document.getElementById("messages");
var form = document.getElementById("form");
var input = document.getElementById("input");
var status = document.getElementById("status");
var ws;

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
    addMessage(e.data, "received");
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
    addMessage(msg, "sent");
    input.value = "";
  }
};

connect();
