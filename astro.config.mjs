// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import node from '@astrojs/node';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
if (existsSync('.env')) loadEnvFile('.env');
const appOrigin = process.env.APP_ORIGIN
  ? new URL(process.env.APP_ORIGIN)
  : null;

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone', bodySizeLimit: 262144 }),
  security: {
    allowedDomains: appOrigin
      ? [
          {
            protocol: appOrigin.protocol.slice(0, -1),
            hostname: appOrigin.hostname,
            port:
              appOrigin.port ||
              (appOrigin.protocol === 'https:' ? '443' : '80'),
          },
        ]
      : [
          { protocol: 'http', hostname: 'localhost' },
          { protocol: 'http', hostname: '127.0.0.1' },
        ],
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
