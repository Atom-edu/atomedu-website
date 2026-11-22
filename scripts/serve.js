import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const mime = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".mp4", "video/mp4"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"],
]);

async function regularFile(candidate) {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

export async function resolveRequestPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const exact = path.resolve(root, relative);
  if (!exact.startsWith(root)) return null;
  if (await regularFile(exact)) return exact;
  if (!path.extname(exact) && (await regularFile(`${exact}.html`))) return `${exact}.html`;
  return null;
}

export function startServer(port = Number(process.env.PORT || 8080)) {
  const server = createServer(async (request, response) => {
    const method = request.method || "GET";
    if (method !== "GET" && method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    const requested = await resolveRequestPath(pathname);
    const fallback = path.join(root, "404.html");
    const file = requested || fallback;
    const info = await stat(file);
    response.writeHead(requested ? 200 : 404, {
      "Cache-Control": "no-store",
      "Content-Length": info.size,
      "Content-Type": mime.get(path.extname(file).toLowerCase()) || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    if (method === "HEAD") response.end();
    else createReadStream(file).pipe(response);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`atomEDU local site: http://localhost:${port}`);
    console.log(`Proof Lab: http://localhost:${port}/proof-lab`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer();
