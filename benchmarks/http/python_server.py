from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"Hello, World!")

    def log_message(self, format, *args):
        pass


server = ThreadingHTTPServer(("", 9876), Handler)
print("Python listening on 9876")
server.serve_forever()
