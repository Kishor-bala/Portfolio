/**
 * ecosystem.config.js — PM2 Process Manager Configuration
 *
 * Usage:
 *   pm2 start ecosystem.config.js              # Start in production
 *   pm2 start ecosystem.config.js --env dev    # Start in dev mode (1 instance)
 *   pm2 reload ecosystem.config.js             # Zero-downtime reload
 *   pm2 stop lasak-ai                          # Stop
 *   pm2 logs lasak-ai                          # View logs
 *   pm2 monit                                  # Live dashboard
 *   pm2 save                                   # Save process list
 *   pm2 startup                                # Auto-start on system reboot
 */

module.exports = {
    apps: [
        {
            // ── Main Server ──────────────────────────────────────────────────
            name: 'lasak-ai',
            script: 'server.js',

            // Cluster mode: spawn one process per CPU core for max concurrency.
            // All processes share the Redis-backed rate limiter and cache.
            // For a 2-core VPS set instances: 2; for a 4-core set instances: 4.
            instances: 2,
            exec_mode: 'cluster',

            // Auto-restart if memory exceeds 400MB
            max_memory_restart: '400M',

            // Don't watch files in production (use pm2 reload for deploys)
            watch: false,

            // Graceful shutdown: wait 3s for in-flight requests to finish
            kill_timeout: 3000,

            // Wait up to 10s for the app to be ready before marking it online
            listen_timeout: 10000,

            // Restart delay after crash (exponential backoff up to 30s)
            restart_delay: 1000,
            max_restarts: 10,
            min_uptime: '10s',

            // Log configuration
            error_file: './logs/pm2-error.log',
            out_file: './logs/pm2-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,      // merge logs from all cluster instances

            // Environment variables
            env: {
                NODE_ENV: 'production',
                PORT: 8080
            },
            env_dev: {
                NODE_ENV: 'development',
                PORT: 8080,
                instances: 1       // single instance in dev for easy debugging
            }
        }
    ]
};
