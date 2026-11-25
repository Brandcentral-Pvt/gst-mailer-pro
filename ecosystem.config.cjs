// PM2 process definition for the production VPS deploy.
// Single instance on purpose: the app keeps state in JSON files under data/.
module.exports = {
  apps: [
    {
      name: 'gst-mailer-pro',
      script: 'server/index.js',
      cwd: '/var/www/gst-mailer-pro',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 8000,
      },
      max_memory_restart: '1G',
      error_file: '/var/log/gst-mailer-pro/error.log',
      out_file: '/var/log/gst-mailer-pro/out.log',
      time: true,
    },
  ],
};
