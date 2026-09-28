import { createProxyMiddleware } from "http-proxy-middleware";
import type { Request, Response } from "express";

export function createServiceProxy(targetUrl: string, pathPrefix: string) {
  return createProxyMiddleware({
    target: targetUrl,
    changeOrigin: true,
    // Express strips the app.use() mount prefix from req.url before this
    // middleware ever sees it, but every downstream service mounts its own
    // routes under that same prefix (e.g. job-service expects
    // /api/job/external, not /external) — so it must be added back here.
    pathRewrite: (path: string) => pathPrefix + path,
    on: {
      proxyReq: (proxyReq, req: Request) => {
        const reqWithId = req as Request & { id?: string };
        if (reqWithId.id) {
          proxyReq.setHeader("x-request-id", reqWithId.id);
        }
        if (process.env.INTERNAL_SERVICE_KEY) {
          proxyReq.setHeader("x-internal-service-key", process.env.INTERNAL_SERVICE_KEY);
        }
      },
      error: (err: Error, req: Request, res: Response | any) => {
        if (!res.headersSent) {
          res.status(502).json({
            message: "Bad Gateway: Upstream service unavailable",
            code: "BAD_GATEWAY",
            requestId: (req as Request & { id?: string }).id,
            timestamp: new Date().toISOString(),
          });
        }
      },
    },
  });
}
