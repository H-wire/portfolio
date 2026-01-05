import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config";
import { errorHandler } from "./middleware/errorHandler";
import { requestId } from "./middleware/requestId";
import { requestLogger } from "./middleware/requestLogger";
import { authRateLimiter, apiRateLimiter } from "./middleware/rateLimit";
import { authRouter } from "./routes/auth";
import { healthRouter } from "./routes/health";
import { listingsRouter } from "./routes/listings";
import { instrumentsRouter } from "./routes/instruments";
import { exchangesRouter } from "./routes/exchanges";
import { meRouter } from "./routes/me";
import { orgsRouter } from "./routes/orgs";
import { analysisRouter } from "./routes/analysis";
import { newsRouter } from "./routes/news";
import { notificationsRouter } from "./routes/notifications";
import { portfoliosRouter } from "./routes/portfolios";
import { performanceRouter } from "./routes/performance";
import { recommendationsRouter } from "./routes/recommendations";
import { versionRouter } from "./routes/version";
import { requireAuth } from "./middleware/auth";
import { requireOrgScope } from "./middleware/orgScope";

const app = express();

app.set("trust proxy", 1);
app.set("etag", "weak");
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"]
      }
    }
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || config.corsOrigins.length === 0) {
        return callback(null, true);
      }
      const localhostAllowlist = ["http://localhost:5173", "http://127.0.0.1:5173"];
      if (config.corsOrigins.includes(origin) || localhostAllowlist.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(requestId);
app.use(requestLogger);

app.use("/api/v1", healthRouter);
app.use("/api/v1", versionRouter);
app.use("/api/v1/auth", authRateLimiter, authRouter);
app.use("/api/v1", apiRateLimiter, meRouter);
app.use("/api/v1", apiRateLimiter, orgsRouter);
app.use(
  "/api/v1/orgs/:orgId",
  apiRateLimiter,
  requireAuth,
  requireOrgScope,
  listingsRouter,
  instrumentsRouter,
  exchangesRouter,
  portfoliosRouter,
  performanceRouter,
  recommendationsRouter,
  analysisRouter,
  newsRouter,
  notificationsRouter
);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`API listening on ${config.port}`);
});
