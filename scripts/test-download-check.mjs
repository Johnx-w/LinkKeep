import assert from "node:assert/strict";
import { createServer } from "node:http";
import { verifyDownloadStart } from "./download-check.mjs";

const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS3sAAAAASUVORK5CYII=", "base64");
const server = createServer((request, response) => {
  if (request.url.includes("good")) { response.writeHead(200, { "content-type": "image/png" }); response.end(image); }
  else if (request.url.includes("redirect")) { response.writeHead(307, { location: "/bad-source" }); response.end(); }
  else { response.writeHead(200, { "content-type": "image/jpeg" }); response.end("<html>not media</html>"); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
try {
  assert.equal(await verifyDownloadStart(origin, { token: "good", kind: "image" }), true);
  assert.equal(await verifyDownloadStart(origin, { token: "fake", kind: "image" }), false);
  assert.equal(await verifyDownloadStart(origin, { token: "redirect", kind: "image" }, "direct"), false);
  console.log("Download-start validation verified: actual image accepted; fake MIME and a 307 redirect to non-media rejected.");
} finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
