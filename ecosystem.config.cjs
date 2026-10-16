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
        TOROB_API_BASE: process.env.TOROB_API_BASE || "",
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
