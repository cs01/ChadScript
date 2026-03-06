export function getHeader(headersRaw: string, name: string): string {
  const lower = name.toLowerCase();
  const lines = headersRaw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) continue;
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const key = line.substring(0, colon).toLowerCase().trim();
    if (key === lower) {
      return line.substring(colon + 1).trim();
    }
  }
  return "";
}

export function parseQueryString(qs: string): Map<string, string> {
  const result = new Map<string, string>();
  if (qs.length === 0) return result;
  const pairs = qs.split("&");
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const eq = pair.indexOf("=");
    if (eq < 0) {
      result.set(pair, "");
    } else {
      result.set(pair.substring(0, eq), pair.substring(eq + 1));
    }
  }
  return result;
}

export function parseCookies(cookieHeader: string): Map<string, string> {
  const result = new Map<string, string>();
  if (cookieHeader.length === 0) return result;
  const parts = cookieHeader.split(";");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    const eq = part.indexOf("=");
    if (eq < 0) {
      result.set(part, "");
    } else {
      result.set(part.substring(0, eq).trim(), part.substring(eq + 1).trim());
    }
  }
  return result;
}

export function httpServe(port: number, handler: (req: HttpRequest) => HttpResponse): void {}
export function wsBroadcast(message: string): void {}
export function wsSend(connId: string, message: string): void {}
export function parseMultipart(req: HttpRequest): MultipartPart[] {
  return [];
}
export function bytesResponse(data: Uint8Array, status: number, headers: string): HttpResponse {
  return { status: 0, body: "", headers: "", bodyLen: 0 };
}
export function serveFile(path: string, contentType: string): HttpResponse {
  const data: Uint8Array = fs.readFileSync(path);
  return bytesResponse(data, 200.0, "Content-Type: " + contentType);
}

export class RouterRequest {
  method: string;
  path: string;
  body: string;
  contentType: string;
  headers: string;
  bodyLen: number;
  queryString: string;
  private _params: Map<string, string>;

  constructor(req: HttpRequest, params: Map<string, string>) {
    this.method = req.method;
    this.path = req.path;
    this.body = req.body;
    this.contentType = req.contentType;
    this.headers = req.headers;
    this.bodyLen = req.bodyLen;
    this.queryString = req.queryString;
    this._params = params;
  }

  param(name: string): string {
    const val = this._params.get(name);
    if (val === undefined) return "";
    return val;
  }

  header(name: string): string {
    return getHeader(this.headers, name);
  }

  bodyBytes(): Uint8Array {
    return Uint8Array.fromRawBytes(this.body, this.bodyLen);
  }
}

export class Context {
  req: RouterRequest;
  private _status: number;
  private _extraHeaders: string;
  private _resultBody: string;
  private _resultHeaders: string;
  private _resultStatus: number;

  constructor(req: RouterRequest) {
    this.req = req;
    this._status = 200;
    this._extraHeaders = "";
    this._resultBody = "";
    this._resultHeaders = "";
    this._resultStatus = 200;
  }

  status(code: number): Context {
    this._status = code;
    return this;
  }

  header(name: string, value: string): Context {
    if (this._extraHeaders.length > 0) {
      this._extraHeaders = this._extraHeaders + "\n" + name + ": " + value;
    } else {
      this._extraHeaders = name + ": " + value;
    }
    return this;
  }

  text(body: string): HttpResponse {
    let hdrs = "Content-Type: text/plain";
    if (this._extraHeaders.length > 0) {
      hdrs = hdrs + "\n" + this._extraHeaders;
    }
    this._resultBody = body;
    this._resultHeaders = hdrs;
    this._resultStatus = this._status;
    return { status: this._status, body: body, headers: hdrs, bodyLen: 0 };
  }

  json(data: string): HttpResponse {
    let hdrs = "Content-Type: application/json";
    if (this._extraHeaders.length > 0) {
      hdrs = hdrs + "\n" + this._extraHeaders;
    }
    this._resultBody = data;
    this._resultHeaders = hdrs;
    this._resultStatus = this._status;
    return { status: this._status, body: data, headers: hdrs, bodyLen: 0 };
  }

  html(body: string): HttpResponse {
    let hdrs = "Content-Type: text/html";
    if (this._extraHeaders.length > 0) {
      hdrs = hdrs + "\n" + this._extraHeaders;
    }
    this._resultBody = body;
    this._resultHeaders = hdrs;
    this._resultStatus = this._status;
    return { status: this._status, body: body, headers: hdrs, bodyLen: 0 };
  }

  redirect(url: string): HttpResponse {
    let hdrs = "Location: " + url;
    if (this._extraHeaders.length > 0) {
      hdrs = hdrs + "\n" + this._extraHeaders;
    }
    this._resultBody = "";
    this._resultHeaders = hdrs;
    this._resultStatus = 302;
    return { status: 302, body: "", headers: hdrs, bodyLen: 0 };
  }

  bytes(data: Uint8Array, contentType: string): HttpResponse {
    let hdrs = "Content-Type: " + contentType;
    if (this._extraHeaders.length > 0) {
      hdrs = hdrs + "\n" + this._extraHeaders;
    }
    return bytesResponse(data, this._status, hdrs);
  }

  getResult(): HttpResponse {
    return {
      status: this._resultStatus,
      body: this._resultBody,
      headers: this._resultHeaders,
      bodyLen: 0,
    };
  }
}

class RouteHandler {
  private _fn: (c: Context) => HttpResponse;
  private _env: string;

  constructor(fn: (c: Context) => HttpResponse, env: string) {
    this._fn = fn;
    this._env = env;
  }

  dispatch(c: Context): HttpResponse {
    if (this._env !== null) {
      callHandler(this._fn, this._env, c);
    } else {
      callHandler(this._fn, c);
    }
    return c.getResult();
  }
}

interface RouteEntry {
  method: string;
  pattern: string;
  paramNames: string;
  handlerIndex: number;
}

export class Router {
  private routes: RouteEntry[];
  private handlers: RouteHandler[];
  private notFoundHandler: RouteHandler | null;

  constructor() {
    this.routes = [];
    this.handlers = [];
    this.notFoundHandler = null;
  }

  private addRoute(
    method: string,
    pattern: string,
    handler: (c: Context) => HttpResponse,
    env: string,
  ): void {
    const paramNames = this.extractParamNames(pattern);
    const entry: RouteEntry = {
      method: method,
      pattern: pattern,
      paramNames: paramNames,
      handlerIndex: this.handlers.length,
    };
    this.routes.push(entry);
    this.handlers.push(new RouteHandler(handler, env));
  }

  get(pattern: string, handler: (c: Context) => HttpResponse, env: string): void {
    this.addRoute("GET", pattern, handler, env);
  }

  post(pattern: string, handler: (c: Context) => HttpResponse, env: string): void {
    this.addRoute("POST", pattern, handler, env);
  }

  put(pattern: string, handler: (c: Context) => HttpResponse, env: string): void {
    this.addRoute("PUT", pattern, handler, env);
  }

  delete(pattern: string, handler: (c: Context) => HttpResponse, env: string): void {
    this.addRoute("DELETE", pattern, handler, env);
  }

  all(pattern: string, handler: (c: Context) => HttpResponse, env: string): void {
    this.addRoute("*", pattern, handler, env);
  }

  notFound(handler: (c: Context) => HttpResponse, env: string): void {
    this.notFoundHandler = new RouteHandler(handler, env);
  }

  private extractParamNames(pattern: string): string {
    let result = "";
    let i = 0;
    while (i < pattern.length) {
      if (pattern[i] === ":") {
        let j = i + 1;
        while (j < pattern.length && pattern[j] !== "/" && pattern[j] !== "?") {
          j = j + 1;
        }
        const name = pattern.substring(i + 1, j);
        if (result.length > 0) {
          result = result + ",";
        }
        result = result + name;
        i = j;
      } else {
        i = i + 1;
      }
    }
    return result;
  }

  private patternToRegex(pattern: string): string {
    let result = "";
    let i = 0;
    while (i < pattern.length) {
      const ch = pattern[i];
      if (ch === ":") {
        let j = i + 1;
        while (j < pattern.length && pattern[j] !== "/" && pattern[j] !== "?") {
          j = j + 1;
        }
        result = result + "([^/]+)";
        i = j;
      } else if (ch === ".") {
        result = result + "\\.";
        i = i + 1;
      } else if (ch === "*") {
        result = result + "(.*)";
        i = i + 1;
      } else {
        result = result + ch;
        i = i + 1;
      }
    }
    return result;
  }

  handle(rawReq: HttpRequest): HttpResponse {
    const path = rawReq.path;
    const method = rawReq.method;

    for (let i = 0; i < this.routes.length; i++) {
      const route = this.routes[i];
      if (route.method !== "*" && route.method !== method) continue;
      const routeRegex = new RegExp("^" + this.patternToRegex(route.pattern) + "$");
      const routeMatch = routeRegex.exec(path);
      if (routeMatch === null) continue;
      const params = new Map<string, string>();
      if (route.paramNames !== "") {
        const names = route.paramNames.split(",");
        for (let j = 0; j < names.length; j++) {
          if (j + 1 < routeMatch.length) {
            params.set(names[j], routeMatch[j + 1]);
          }
        }
      }
      const rreq = new RouterRequest(rawReq, params);
      const ctx = new Context(rreq);
      return this.handlers[route.handlerIndex].dispatch(ctx);
    }

    const emptyParams = new Map<string, string>();
    const rreq = new RouterRequest(rawReq, emptyParams);
    const ctx = new Context(rreq);

    if (this.notFoundHandler !== null) {
      return this.notFoundHandler.dispatch(ctx);
    }
    return { status: 404, body: "Not Found", headers: "" };
  }
}
