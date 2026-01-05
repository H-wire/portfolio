type LogContext = {
  request_id?: string;
  method: string;
  path: string;
  status?: number;
  duration_ms?: number;
  org_id?: number | null;
  user_id?: number | null;
};

function logInfo(message: string, context: LogContext) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "INFO",
      message,
      ...context,
    })
  );
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const path = req.originalUrl ?? req.url;

  res.on("finish", () => {
    const duration = Date.now() - start;
    logInfo("request_completed", {
      request_id: req.requestId,
      method: req.method,
      path,
      status: res.statusCode,
      duration_ms: duration,
      org_id: req.orgId ?? null,
      user_id: req.user?.id ?? null,
    });
  });

  next();
}
