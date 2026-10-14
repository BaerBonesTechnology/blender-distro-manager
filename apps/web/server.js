import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./store.js";
import { catalog } from "../../packages/core/catalog.js";
const dir = path.dirname(fileURLToPath(import.meta.url));
const data = path.resolve(process.env.BDM_DATA || ".data");
await fs.mkdir(data, { recursive: true });
const store = createStore(path.join(data, "submissions.sqlite"));
const server = http.createServer(async (req, res) => {
  const send = (code, data, type = "application/json") => {
    res.writeHead(code, {
      "Content-Type": type,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    res.end(typeof data === "string" ? data : JSON.stringify(data));
  };
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/api/catalog")
      return send(200, [
        ...catalog,
        ...store
          .public()
          .map((s) => ({
            ...s,
            id: `community-${s.id}`,
            category: "Community",
            platforms: [],
          })),
      ]);
    if (req.method === "POST" && url.pathname === "/api/submissions") {
      if (
        req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}`
      )
        return send(403, { error: "Origin rejected" });
      if (!req.headers["content-type"]?.startsWith("application/json"))
        return send(415, { error: "Use JSON" });
      let body = "";
      for await (const part of req) {
        body += part;
        if (Buffer.byteLength(body) > 8192)
          return send(413, { error: "Submission too large" });
      }
      return send(201, store.submit(JSON.parse(body)));
    }
    const assets = {
      "/": "index.html",
      "/downloads": "index.html",
      "/distros": "index.html",
      "/submit": "index.html",
      "/style.css": "style.css",
      "/web.js": "web.js",
    };
    if (req.method === "GET" && assets[url.pathname])
      return send(
        200,
        await fs.readFile(path.join(dir, assets[url.pathname]), "utf8"),
        url.pathname.endsWith(".css")
          ? "text/css"
          : url.pathname.endsWith(".js")
            ? "text/javascript"
            : "text/html",
      );
    send(404, { error: "Not found" });
  } catch (e) {
    send(400, { error: e.message });
  }
});
server.listen(Number(process.env.PORT || 4310), "127.0.0.1", () =>
  console.log(
    "Blender Distro Manager website: http://127.0.0.1:" + server.address().port,
  ),
);
