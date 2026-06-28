# platypusgit marketing site

Astro static site for [platypusgit](https://github.com/jonassaa/platypusgit).
Deployed to GitHub Pages at https://jonassaa.github.io/platypusgit.

## Develop

```bash
pnpm install
pnpm dev      # http://localhost:4321/platypusgit
pnpm build    # output -> dist/
pnpm preview  # serve the build locally
```

## Configuration

All external links live in `src/data/site.ts`. Set the real **Buy Me a Coffee**
URL there (`buyMeACoffee`) and in `../.github/FUNDING.yml` (`buy_me_a_coffee` handle).

Feature/changelog content lives in `src/data/features.ts`.

## Deploy

Pushing to `main` with changes under `site/**` triggers `.github/workflows/site.yml`,
which builds and deploys to Pages.

**One-time repo setting (required):** GitHub → Settings → Pages → Build and
deployment → Source = **GitHub Actions**.
