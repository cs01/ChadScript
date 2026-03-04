import { getHeader } from "chadscript/http";

interface HttpRequest {
  method: string;
  path: string;
  body: string;
  contentType: string;
  headers: string;
  bodyLen: number;
}

interface HttpResponse {
  status: number;
  body: string;
  headers: string;
}

class RouterRequest {
  method: string;
  path: string;
  body: string;
  contentType: string;
  headers: string;
  private _params: Map<string, string>;

  constructor(req: HttpRequest, params: Map<string, string>) {
    this.method = req.method;
    this.path = req.path;
    this.body = req.body;
    this.contentType = req.contentType;
    this.headers = req.headers;
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
    return { status: this._status, body: body, headers: hdrs };
  }

  json(data: any): HttpResponse {
    let hdrs = "Content-Type: application/json";
    if (this._extraHeaders.length > 0) {
      hdrs = hdrs + "\n" + this._extraHeaders;
    }
    this._resultBody = data;
    this._resultHeaders = hdrs;
    this._resultStatus = this._status;
    return { status: this._status, body: data, headers: hdrs };
  }

  html(body: string): HttpResponse {
    let hdrs = "Content-Type: text/html";
    if (this._extraHeaders.length > 0) {
      hdrs = hdrs + "\n" + this._extraHeaders;
    }
    this._resultBody = body;
    this._resultHeaders = hdrs;
    this._resultStatus = this._status;
    return { status: this._status, body: body, headers: hdrs };
  }

  redirect(url: string): HttpResponse {
    let hdrs = "Location: " + url;
    if (this._extraHeaders.length > 0) {
      hdrs = hdrs + "\n" + this._extraHeaders;
    }
    this._resultBody = "";
    this._resultHeaders = hdrs;
    this._resultStatus = 302;
    return { status: 302, body: "", headers: hdrs };
  }

  getResult(): HttpResponse {
    return { status: this._resultStatus, body: this._resultBody, headers: this._resultHeaders };
  }
}

class RouteHandler {
  private _fn: (c: Context) => HttpResponse;

  constructor(fn: (c: Context) => HttpResponse) {
    this._fn = fn;
  }

  dispatch(c: Context): HttpResponse {
    callHandler(this._fn, c);
    return c.getResult();
  }
}

interface RouteEntry {
  method: string;
  pattern: string;
  paramNames: string;
  groupOffset: number;
  groupCount: number;
  handlerIndex: number;
}

export class Router {
  private routes: RouteEntry[];
  private handlers: RouteHandler[];
  private notFoundHandler: RouteHandler | null;
  private compiled: boolean;
  private compiledRegex: RegExp;

  constructor() {
    this.routes = [];
    this.handlers = [];
    this.notFoundHandler = null;
    this.compiled = false;
    this.compiledRegex = new RegExp(".");
  }

  private addRoute(method: string, pattern: string, handler: (c: Context) => HttpResponse): void {
    this.compiled = false;
    const paramNames = this.extractParamNames(pattern);
    const entry: RouteEntry = {
      method: method,
      pattern: pattern,
      paramNames: paramNames,
      groupOffset: 0,
      groupCount: 0,
      handlerIndex: this.handlers.length,
    };
    this.routes.push(entry);
    this.handlers.push(new RouteHandler(handler));
  }

  get(pattern: string, handler: (c: Context) => HttpResponse): void {
    this.addRoute("GET", pattern, handler);
  }

  post(pattern: string, handler: (c: Context) => HttpResponse): void {
    this.addRoute("POST", pattern, handler);
  }

  put(pattern: string, handler: (c: Context) => HttpResponse): void {
    this.addRoute("PUT", pattern, handler);
  }

  delete(pattern: string, handler: (c: Context) => HttpResponse): void {
    this.addRoute("DELETE", pattern, handler);
  }

  all(pattern: string, handler: (c: Context) => HttpResponse): void {
    this.addRoute("*", pattern, handler);
  }

  notFound(handler: (c: Context) => HttpResponse): void {
    this.notFoundHandler = new RouteHandler(handler);
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

  private countGroups(regexPart: string): number {
    let count = 0;
    for (let i = 0; i < regexPart.length; i++) {
      if (regexPart[i] === "(") {
        count = count + 1;
      }
    }
    return count;
  }

  compile(): void {
    if (this.compiled) return;
    let combined = "";
    let offset = 1;
    for (let i = 0; i < this.routes.length; i++) {
      const route = this.routes[i];
      const regexPart = this.patternToRegex(route.pattern);
      const wrapped = "(" + regexPart + ")";
      const innerGroups = this.countGroups(regexPart);

      route.groupOffset = offset;
      route.groupCount = innerGroups;

      if (combined.length > 0) {
        combined = combined + "|";
      }
      combined = combined + wrapped;
      offset = offset + 1 + innerGroups;
    }
    this.compiledRegex = new RegExp(combined);
    this.compiled = true;
  }

  handle(rawReq: HttpRequest): HttpResponse {
    this.compile();

    const path = rawReq.path;
    const method = rawReq.method;
    const match = this.compiledRegex.exec(path);

    if (match !== null) {
      for (let i = 0; i < this.routes.length; i++) {
        const route = this.routes[i];
        const outerGroup = match[route.groupOffset];
        if (outerGroup !== undefined && outerGroup !== null && outerGroup !== "") {
          if (route.method === "*" || route.method === method) {
            const params = new Map<string, string>();
            if (route.paramNames !== "") {
              const names = route.paramNames.split(",");
              for (let j = 0; j < names.length; j++) {
                const groupIdx = route.groupOffset + 1 + j;
                if (groupIdx < match.length) {
                  params.set(names[j], match[groupIdx]);
                }
              }
            }
            const rreq = new RouterRequest(rawReq, params);
            const ctx = new Context(rreq);
            return this.handlers[route.handlerIndex].dispatch(ctx);
          }
        }
      }
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
