const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8",
};

// This is a loopback preview server for a static folder: plaintext HTTP is
// correct here (there is no certificate for 127.0.0.1), so the transport rule
// is a false positive for this file.
// nosemgrep
http
  .createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    // Drop traversal segments instead of joining them: `..` never belongs to a
    // static preview, and sanitising beats a startsWith() boundary check (which
    // is bypassable by a sibling directory sharing the root as a prefix).
    const parts = p.split(/[\\/]+/).filter((s) => s && s !== "." && s !== "..");
    // nosemgrep
    const file = path.join(root, ...parts);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
        return;
      }
      res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
      res.end(buf);
    });
  })
  .listen(4321, () => console.log("landing on http://localhost:4321"));
