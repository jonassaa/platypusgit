// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.platypusgit.com',
  // GitHub Pages 301s /features -> /features/, so the canonical form of every
  // URL carries a trailing slash. Keeping Astro, the sitemap, and the internal
  // links on 'always' means no crawler (or visitor) eats a redirect hop.
  trailingSlash: 'always',
  integrations: [sitemap()],
});
