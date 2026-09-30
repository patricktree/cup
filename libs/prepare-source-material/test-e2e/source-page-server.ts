import http from "node:http";

import anthropic from "#test-e2e/fixtures/anthropic.json" with { type: "json" };
import cloudflare from "#test-e2e/fixtures/cloudflare.json" with { type: "json" };
import gatesNotes from "#test-e2e/fixtures/gates-notes.json" with { type: "json" };

const recordings = new Map(
  [...anthropic, ...cloudflare, ...gatesNotes].map((recording) => [recording.url, recording]),
);

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1:4187");
  if (url.pathname === "/health") {
    response.writeHead(200).end("Ready");
    return;
  }

  const recording = recordings.get(url.searchParams.get("url") ?? "");
  if (url.pathname !== "/resource" || !recording) {
    response.writeHead(404).end("No recorded source-page response");
    return;
  }

  response.writeHead(recording.status, {
    "content-type": recording.contentType,
    "access-control-allow-origin": "*",
  });
  response.end(recording.body);
});

server.listen(4187, "127.0.0.1");
