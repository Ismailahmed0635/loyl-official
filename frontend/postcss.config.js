const path = require('path');

module.exports = {
  plugins: {
    // Absolute path: Tailwind auto-discovers its config from process.cwd(),
    // but Next runs as `next dev frontend` with cwd = repo root.
    tailwindcss: { config: path.join(__dirname, 'tailwind.config.ts') },
    autoprefixer: {},
  },
};
