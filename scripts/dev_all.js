const { spawn } = require("child_process");
const path = require("path");

function parseArgs(argv) {
  const result = { host: null, port: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--host") {
      result.host = argv[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith("--host=")) {
      result.host = arg.split("=")[1] || null;
    } else if (arg === "--port") {
      result.port = argv[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith("--port=")) {
      result.port = arg.split("=")[1] || null;
    }
  }
  return result;
}

function buildFrontendCommand(host, port) {
  const args = ["npm", "run", "dev:frontend", "--"];
  if (host) {
    args.push("--host", host);
  }
  if (port) {
    args.push("--port", port);
  }
  return args.join(" ");
}

const { host, port } = parseArgs(process.argv.slice(2));
const concurrentlyPath = path.join(
  __dirname,
  "..",
  "node_modules",
  ".bin",
  "concurrently"
);

const commands = [
  "npm run dev",
  buildFrontendCommand(host, port),
  "npm run dev:yfinance",
  "bash scripts/wait_for_yfinance.sh && npm run dev:jobs",
];

const child = spawn(
  `${concurrentlyPath} ${commands.map((cmd) => `\"${cmd}\"`).join(" ")}`,
  {
    stdio: "inherit",
    shell: true,
  }
);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
