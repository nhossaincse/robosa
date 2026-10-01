import { defineConfig, loadEnv } from 'vite';
import { robosaApiPlugin } from './server/providers/robosa/api.js';
import { robosaRoutesPlugin } from './server/providers/robosa/routes.js';

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));

  const host = process.env.HOST || '127.0.0.1';
  const port = Number.parseInt(process.env.PORT || '4173', 10);

  return {
    plugins: [robosaApiPlugin(), robosaRoutesPlugin()],
    server: {
      host,
      port,
      strictPort: true,
    },
    preview: {
      host,
      port,
      strictPort: true,
    },
    build: {
      rollupOptions: {
        input: {
          robosa: 'robosa.html',
        },
      },
    },
  };
});
