// Client-side WebSocket chat logic.
// Connects to the server, sends/receives messages, auto-reconnects.

var messages = document.getElementById("messages");
var form = document.getElementById("form");
var input = document.getElementById("input");
var status = document.getElementById("status");
var sendBtn = document.getElementById("send-btn");
var ws;
var myId = Math.random().toString(36).slice(2, 8);
var lastSender = null;

function shortName(id) {
  return "User " + id.slice(-4);
}

function addMessage(text, type, senderId) {
  if (type === "received" && senderId && senderId !== lastSender) {
    var nameEl = document.createElement("div");
    nameEl.className = "sender-name";
    nameEl.textContent = shortName(senderId);
    messages.appendChild(nameEl);
  }
  lastSender = type === "system" ? null : senderId || type;

  var div = document.createElement("div");
  div.className = "message " + type;
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function connect() {
  status.textContent = "connecting...";
  status.className = "status";
  sendBtn.disabled = true;
  ws = new WebSocket("ws://" + location.host + "/ws");

  ws.onopen = function () {
    status.textContent = "connected";
    status.className = "status connected";
    sendBtn.disabled = input.value.trim().length === 0;
  };

  ws.onmessage = function (e) {
    var data = e.data;
    if (data.startsWith("sys|")) {
      addMessage(data.slice(4), "system", null);
      return;
    }
    if (data.startsWith("msg|")) {
      var rest = data.slice(4);
      var sep = rest.indexOf("|");
      var sender = rest.slice(0, sep);
      var msg = rest.slice(sep + 1);
      addMessage(msg, sender === myId ? "sent" : "received", sender);
      return;
    }
    addMessage(data, "received", null);
  };

  ws.onerror = function () {
    addMessage("Connection error", "system", null);
  };

  ws.onclose = function () {
    status.textContent = "disconnected";
    status.className = "status disconnected";
    sendBtn.disabled = true;
    lastSender = null;
    addMessage("Disconnected — reconnecting...", "system", null);
    setTimeout(connect, 2000);
  };
}

input.addEventListener("input", function () {
  sendBtn.disabled = !input.value.trim() || !ws || ws.readyState !== 1;
});

form.onsubmit = function (e) {
  e.preventDefault();
  var msg = input.value.trim();
  if (msg.length > 0 && ws && ws.readyState === 1) {
    ws.send(myId + "|" + msg);
    input.value = "";
    sendBtn.disabled = true;
  }
};

connect();
