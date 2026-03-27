import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

const clients = new Map<string, Set<WebSocket>>();

export function initWebSocketServer(httpServer: Server) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws, req) => {
    try {
      const url = req.url ? new URL(req.url, "http://x") : null;
      const jobId = url?.searchParams.get("jobId");
      if (!jobId) {
        ws.close();
        return;
      }

      if (!clients.has(jobId)) clients.set(jobId, new Set());
      clients.get(jobId)!.add(ws);

      ws.on("close", () => {
        clients.get(jobId)?.delete(ws);
        if (clients.get(jobId)?.size === 0) clients.delete(jobId);
      });
    } catch {
      ws.close();
    }
  });
}

export function broadcastJobProgress(jobId: string, payload: object) {
  clients.get(jobId)?.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  });
}
