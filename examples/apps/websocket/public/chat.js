// Client-side WebSocket chat logic.
// Connects to the server, sends/receives messages, auto-reconnects.

const messages = document.getElementById("messages");
const form = document.getElementById("form");
const input = document.getElementById("input");
const statusEl = document.getElementById("status");
const sendBtn = document.getElementById("send-btn");
let ws;
const myId = Math.random().toString(36).slice(2, 8);
let lastSender = null;

function shortName(id) {
  return "User " + id.slice(-4);
}

function addMessage(text, type, senderId) {
  if (type === "received" && senderId && senderId !== lastSender) {
    const nameEl = document.createElement("div");
    nameEl.className = "sender-name";
    nameEl.textContent = shortName(senderId);
    messages.appendChild(nameEl);
  }
  lastSender = type === "system" ? null : senderId || type;

  const div = document.createElement("div");
  div.className = "message " + type;
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function connect() {
  statusEl.textContent = "connecting...";
  statusEl.className = "status";
  sendBtn.disabled = true;
  ws = new WebSocket("ws://" + location.host + "/ws");

  ws.onopen = function () {
    statusEl.textContent = "connected";
    statusEl.className = "status connected";
    sendBtn.disabled = input.value.trim().length === 0;
  };

  ws.onmessage = function (e) {
    const data = e.data;
    if (data.startsWith("sys|")) {
      addMessage(data.slice(4), "system", null);
      return;
    }
    if (data.startsWith("msg|")) {
      const rest = data.slice(4);
      const sep = rest.indexOf("|");
      const sender = rest.slice(0, sep);
      const msg = rest.slice(sep + 1);
      addMessage(msg, sender === myId ? "sent" : "received", sender);
      return;
    }
    addMessage(data, "received", null);
  };

  ws.onerror = function () {
    addMessage("Connection error", "system", null);
  };

  ws.onclose = function () {
    statusEl.textContent = "disconnected";
    statusEl.className = "status disconnected";
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
  const msg = input.value.trim();
  if (msg.length > 0 && ws && ws.readyState === 1) {
    ws.send(myId + "|" + msg);
    input.value = "";
    sendBtn.disabled = true;
  }
};

connect();
