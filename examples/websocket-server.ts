// WebSocket chat server example — dark theme matching VitePress amber/gold palette.
// Demonstrates httpServe with a wsHandler, wsBroadcast, and inline HTML/CSS/JS.

interface WsEvent {
  data: string;
  event: string;
}

interface HttpRequest {
  method: string;
  path: string;
  body: string;
  contentType: string;
}

interface HttpResponse {
  status: number;
  body: string;
}

let onlineCount = 0;

function wsHandler(event: WsEvent): string {
  if (event.event == "open") {
    onlineCount = onlineCount + 1;
    wsBroadcast("[" + onlineCount + " online]");
    return "";
  }
  if (event.event == "close") {
    onlineCount = onlineCount - 1;
    wsBroadcast("[" + onlineCount + " online]");
    return "";
  }
  if (event.event == "message") {
    wsBroadcast(event.data);
    return "";
  }
  return "";
}

function handleRequest(req: HttpRequest): HttpResponse {
  if (req.path == "/") {
    const html =
      "<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'>" +
      "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
      "<title>ChadScript Chat</title>" +
      "<style>" +
      "*{margin:0;padding:0;box-sizing:border-box}" +
      "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
      "background:#1b1b1f;color:#e2e2e5;height:100vh;display:flex;flex-direction:column}" +
      "header{padding:16px 24px;border-bottom:1px solid #2e2e32;display:flex;align-items:center;gap:12px}" +
      "header h1{font-size:18px;color:#fbbf24;font-weight:600}" +
      ".status{font-size:12px;padding:2px 8px;border-radius:10px}" +
      ".status.ok{background:rgba(34,197,94,0.15);color:#22c55e}" +
      ".status.off{background:rgba(239,68,68,0.15);color:#ef4444}" +
      ".status.wait{background:rgba(251,191,36,0.15);color:#fbbf24}" +
      "#messages{flex:1;overflow-y:auto;padding:16px 24px;display:flex;flex-direction:column;gap:8px}" +
      ".m{padding:8px 12px;border-radius:8px;max-width:80%;background:#2e2e32;font-size:14px;" +
      "line-height:1.4;word-wrap:break-word}" +
      ".m.s{color:#888;font-style:italic;font-size:12px}" +
      ".m.b{border-left:3px solid #f59e0b}" +
      ".m.e{border-left:3px solid #ef4444;color:#ef4444}" +
      ".m.n{border-left:3px solid #fbbf24;color:#fbbf24;font-size:12px}" +
      ".bar{padding:16px 24px;border-top:1px solid #2e2e32;display:flex;gap:8px}" +
      "input{flex:1;padding:10px 14px;border-radius:8px;border:1px solid #3e3e42;" +
      "background:#2e2e32;color:#e2e2e5;font-size:14px;outline:none}" +
      "input:focus{border-color:#fbbf24}" +
      "button{padding:10px 20px;border-radius:8px;border:none;" +
      "background:#f59e0b;color:#1b1b1f;font-weight:600;font-size:14px;cursor:pointer}" +
      "button:hover{background:#fbbf24}" +
      "button:disabled{opacity:0.5;cursor:not-allowed}" +
      "</style></head><body>" +
      "<header><h1>ChadScript Chat</h1>" +
      "<span id='st' class='status wait'>connecting</span></header>" +
      "<div id='messages'></div>" +
      "<div class='bar'><input id='inp' placeholder='Type a message...' disabled>" +
      "<button id='btn' disabled>Send</button></div>" +
      "<script>" +
      "var ms=document.getElementById('messages')," +
      "inp=document.getElementById('inp')," +
      "btn=document.getElementById('btn')," +
      "st=document.getElementById('st'),ws;" +
      "function add(t,c){var d=document.createElement('div');" +
      "d.className='m '+c;d.textContent=t;ms.appendChild(d);ms.scrollTop=ms.scrollHeight}" +
      "function stat(t,c){st.textContent=t;st.className='status '+c}" +
      "function go(){stat('connecting','wait');" +
      "ws=new WebSocket('ws://'+location.host+'/ws');" +
      "ws.onopen=function(){stat('connected','ok');inp.disabled=false;btn.disabled=false;" +
      "inp.focus();add('Connected','s')};" +
      "ws.onmessage=function(e){var d=e.data;" +
      "if(d.charAt(0)==='['){add(d,'n')}else{add(d,'b')}};" +
      "ws.onerror=function(){add('Connection error','e')};" +
      "ws.onclose=function(){stat('disconnected','off');inp.disabled=true;btn.disabled=true;" +
      "add('Disconnected — reconnecting...','s');setTimeout(go,2000)}}" +
      "function send(){var v=inp.value.trim();" +
      "if(v&&ws&&ws.readyState===1){ws.send(v);inp.value=''}}" +
      "btn.onclick=send;" +
      "inp.onkeydown=function(e){if(e.key==='Enter')send()};" +
      "go()" +
      "</script></body></html>";
    return { status: 200, body: html };
  }
  return { status: 404, body: "Not Found" };
}

const port = 8080;
console.log("WebSocket Chat Server");
console.log("  Open http://localhost:" + port + "/ in your browser");
console.log("  Or use: websocat ws://localhost:" + port + "/ws");
httpServe(port, handleRequest, wsHandler);
