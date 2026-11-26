require("dotenv").config({ path: require("path").join(__dirname, ".env") });

module.exports = {
  apps: [
    {
      name: "torob-mcp",
      script: "vendor/torob-mcp/dist/index.js",
      args: "--http",
      env: {
        NODE_ENV: "production",
        PORT: 3005,
        HOST: "127.0.0.1",
        TOROB_API_BASE: process.env.TOROB_API_BASE || "",
        TOROB_RELAY_KEY: process.env.TOROB_RELAY_KEY || "",
        TOROB_MCP_SYNC_SECRET:
          process.env.TOROB_MCP_SYNC_SECRET ||
          process.env.AUTH_SECRET ||
          process.env.SESSION_SECRET ||
          process.env.CRON_SECRET ||
          "",
      },
      autorestart: true,
      max_memory_restart: "250M",
    },
    {
      name: "sgeooole-pricing",
      script: "node_modules/.bin/next",
      args: "start -p 3050",
      env: {
        NODE_ENV: "production",
        PORT: 3050,
      },
      autorestart: true,
      max_memory_restart: "500M",
    },
  ],
};
