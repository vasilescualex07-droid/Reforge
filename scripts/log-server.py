import http.server, sys, urllib.parse

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(q.query)
        m = params.get("m", [""])[0]
        print(f"[{self.address_string()}] {m}", flush=True)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")
    def log_message(self, *a):
        pass

http.server.HTTPServer(("127.0.0.1", 8765), H).serve_forever()
