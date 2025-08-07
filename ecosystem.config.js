module.exports = {
  apps: [{
    name: "davichat-api",
    script: "dist/main.js",
    instances: 1,
    exec_mode: "cluster",
    env: {
      NODE_ENV: "production",
      PORT: 6060
    },
    env_production: {
      NODE_ENV: "production",
      PORT: 6060
    },
    env_development: {
      NODE_ENV: "development",
      PORT: 6060
    },
    // Configuración de logs
    log_file: "./logs/combined.log",
    out_file: "./logs/out.log",
    error_file: "./logs/error.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    
    // Configuración de reinicio
    max_memory_restart: "1G",
    min_uptime: "10s",
    max_restarts: 10,
    
    // Configuración de monitoreo
    watch: false,
    ignore_watch: ["node_modules", "logs", "uploads"]
  }]
};
