#!/usr/bin/env node
// torob-mcp (Node): stdio by default, Streamable HTTP + stateless JSON-RPC 2.0 with --http.
import { createServer } from "node:http";
import { MAX_BODY_BYTES, PORT } from "./config.js";
import { resetBreakerForTests, setUpstreamBase, UpstreamError, UPSTREAM_BASE_ENV } from "./http.js";
import { LANDING, MCP_PAGE } from "./landing.js";
import { takePendingWrites } from "./project.js";
const VERSION = "0.5.9";
const INSTRUCTIONS = "Torob price intelligence MCP server.";
import { installFileStore } from "./store-node.js";
import { READ_ONLY, TOOLS } from "./tools.js";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version, authorization",
  "access-control-expose-headers": "mcp-session-id",
};

async function handleStatelessJsonRpc(parsed: any): Promise<{ status: number; body: unknown } | null> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const id = parsed.id ?? null;
  const method = String(parsed.method ?? "");

  if (method === "initialize") {
    return {
      status: 200,
      body: {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "torob-mcp", version: VERSION },
          instructions: INSTRUCTIONS,
        },
      },
    };
  }

  if (method === "notifications/initialized") {
    return { status: 202, body: null };
  }

  if (method === "ping") {
    return { status: 200, body: { jsonrpc: "2.0", id, result: {} } };
  }

  if (method === "tools/list") {
    return {
      status: 200,
      body: {
        jsonrpc: "2.0",
        id,
        result: {
          tools: TOOLS.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: { ...t.inputSchema, additionalProperties: false },
            annotations: { ...READ_ONLY, title: t.title },
          })),
        },
      },
    };
  }

  if (method === "tools/call") {
    const toolName = String(parsed.params?.name ?? "");
    const args = (parsed.params?.arguments ?? {}) as Record<string, unknown>;
    const tool = TOOLS.find((t) => t.name === toolName);
    if (!tool) {
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: `Unknown tool '${toolName}'. Available: ${TOOLS.map((t) => t.name).join(", ")}.`,
              },
            ],
            isError: true,
          },
        },
      };
    }
    try {
      const data = await tool.run(args);
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          },
        },
      };
    } catch (err) {
      const message =
        err instanceof UpstreamError
          ? err.message
          : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: message }],
            isError: true,
          },
        },
      };
    } finally {
      takePendingWrites();
    }
  }

  return null;
}

async function main() {
  if (process.env.TOROB_MCP_STORE !== "off") installFileStore();
  setUpstreamBase(process.env[UPSTREAM_BASE_ENV]);

  if (process.argv.includes("--http")) {
    const http = createServer((req, res) => {
      const path = (req.url ?? "").split("?")[0];
      if (req.method === "OPTIONS" && (path === "/mcp" || path === "/reset")) {
        res.writeHead(204, { ...CORS_HEADERS, "access-control-max-age": "86400" }).end();
        return;
      }
      if (req.method === "POST" && path === "/reset") {
        resetBreakerForTests()
          .then(() => {
            res
              .writeHead(200, { "content-type": "application/json", ...CORS_HEADERS })
              .end(JSON.stringify({ ok: true, message: "Torob circuit breaker reset" }));
          })
          .catch((e) => {
            res
              .writeHead(500, { "content-type": "application/json", ...CORS_HEADERS })
              .end(JSON.stringify({ ok: false, error: String(e) }));
          });
        return;
      }
      if (req.method === "POST" && path === "/mcp") {
        res.setHeader("access-control-allow-origin", CORS_HEADERS["access-control-allow-origin"]);
        res.setHeader("access-control-expose-headers", CORS_HEADERS["access-control-expose-headers"]);
        let body = "";
        let tooBig = false;
        req.on("data", (c: Buffer | string) => {
          if (tooBig) return;
          body += c;
          if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
            tooBig = true;
            body = "";
            try {
              req.destroy();
            } catch {
              /* ignore */
            }
            if (!res.headersSent) res.writeHead(413).end("Body too large");
          }
        });
        req.on("end", async () => {
          if (tooBig || res.writableEnded) return;
          let parsed: unknown;
          try {
            parsed = body ? JSON.parse(body) : undefined;
          } catch {
            if (!res.headersSent) res.writeHead(400).end("Bad request: invalid JSON");
            return;
          }

          // ۱. اجرای مستقیم و بدون وابستگی JSON-RPC 2.0 (برای tools/call، tools/list، initialize)
          const direct = await handleStatelessJsonRpc(parsed);
          if (direct) {
            if (direct.body === null) {
              res.writeHead(direct.status).end();
            } else {
              res
                .writeHead(direct.status, { "content-type": "application/json; charset=utf-8" })
                .end(JSON.stringify(direct.body));
            }
            return;
          }

          // ۲. Fallback به StreamableHTTPServerTransport در صورت نصب بودن SDK
          try {
            const { StreamableHTTPServerTransport } = await import(
              "@modelcontextprotocol/sdk/server/streamableHttp.js"
            );
            const { buildServer } = await import("./server.js");
            const reqServer = buildServer();
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
            try {
              await reqServer.connect(transport);
              await transport.handleRequest(req, res, parsed as any);
            } finally {
              try {
                await transport.close();
              } catch {
                /* ignore */
              }
              try {
                await reqServer.close();
              } catch {
                /* ignore */
              }
            }
          } catch {
            if (!res.headersSent) res.writeHead(400).end("Bad request");
          }
        });
      } else if (
        (req.method === "GET" || req.method === "HEAD") &&
        (path === "/mcp" || (path || "").startsWith("/mcp?"))
      ) {
        const accept = String(req.headers.accept || "").toLowerCase();
        if (accept.includes("text/html") && !accept.includes("text/event-stream")) {
          res
            .writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" })
            .end(MCP_PAGE);
        } else {
          res
            .writeHead(405, { allow: "POST", "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" })
            .end("Method Not Allowed: this server is stateless, POST to /mcp.");
        }
      } else if (req.method === "GET" && path === "/health") {
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ ok: true, service: "torob-mcp", version: VERSION }));
      } else if (req.method === "GET" && (path === "/" || path === "")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(LANDING);
      } else {
        res.writeHead(404).end("Not found. POST /mcp for MCP, POST /reset to clear breaker, GET /health for health.");
      }
    });
    http.listen(PORT, () => console.error(`torob-mcp HTTP on :${PORT}/mcp`));
  } else {
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const { buildServer } = await import("./server.js");
    await buildServer().connect(new StdioServerTransport());
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
