// PM2 config — fallback if not using Docker
module.exports = {
  apps: [
    {
      name: "apmcb-bff",
      script: "bun",
      args: "run src/index.ts",
      cwd: "/var/www/apmcb/apps/bff",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: { NODE_ENV: "production", PORT: 3001 },
    },
  ],
};
