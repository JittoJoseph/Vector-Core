module.exports = {
  apps: [
    {
      name: "vector-core-api",
      cwd: __dirname + "/backend",
      script: "dist/index.js",
      node_args: "--max-old-space-size=256",
      max_memory_restart: "320M",
      kill_timeout: 5000,
      env: { NODE_ENV: "production", TZ: "UTC" },
    },
  ],
};
