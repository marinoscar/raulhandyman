# raulhandyman.net

Website for **Raul Handyman** — handyman and home repairs in Conroe, The Woodlands and nearby areas, Texas.

- **Stack:** Astro (static output) → nginx container → `proxy-nginx` on the marin VPS
- **Live URL:** https://raulhandyman.net (`www` redirects to the apex)
- **VPS location:** `/opt/infra/apps/raulhandyman` · container `raulhandyman-web` · `127.0.0.1:8330`

## Editing content

All business content lives in one file: [`src/data/site.ts`](src/data/site.ts).

| To change | Edit |
|---|---|
| Phone, email, Google profile links | `business` |
| Towns in the service area | `towns` |
| Services (adds/removes a page automatically) | `services` |
| Homepage FAQ | `homeFaq` |
| Job photos | Drop files into `src/assets/work/` (e.g. `fence-repair-after.jpg`). The "Recent jobs" section appears once one exists. The file name becomes the alt text. |

When `googleReviewUrl` is set, a "Leave a Google review" section appears. When `googleBusinessUrl` is set, it is added to the structured data as `sameAs`.

## Run locally

```bash
npm ci
npm run dev        # http://localhost:4321
npm run build      # outputs to dist/
```

Requires Node 22.22+.

## SEO built in

- One page per service, each with a unique title, description, H1 and canonical URL
- JSON-LD: `HomeAndConstructionBusiness` + `WebSite` on the homepage, `Service` + `BreadcrumbList` on service pages
- `sitemap-index.xml` (auto-generated) and `robots.txt`
- Open Graph / Twitter card image (`public/og.jpg`)
- Self-hosted, preloaded fonts; responsive WebP images; static HTML with no client-side JS framework
- Trailing-slash URLs everywhere, `www` → apex 301, HTTP → HTTPS 301

After launch, validate with Google's [Rich Results Test](https://search.google.com/test/rich-results) and submit `https://raulhandyman.net/sitemap-index.xml` in Search Console.

## Deploy

Follows the `marin-server-infra` pattern: app folder under `/opt/infra/apps`, localhost-bound container, per-host config in `proxy/nginx/conf.d`, certbot webroot certificates.

```
deploy/
  compose.yml           → copied to /opt/infra/apps/raulhandyman/compose.yml
  raulhandyman.conf     → copied to /opt/infra/proxy/nginx/conf.d/raulhandyman.conf
  install.sh            first-time install (DNS check, build, certificate, proxy, verify)
  deploy.sh             update to latest main, with health check and rollback
```

### First install (once)

Prerequisite: DNS in GoDaddy points to the VPS — `A @ → <VPS IP>` and `CNAME www → raulhandyman.net`. Check with `dig +short raulhandyman.net`.

```bash
mkdir -p /opt/infra/apps/raulhandyman
cd /opt/infra/apps/raulhandyman
git clone https://github.com/marinoscar/raulhandyman.git repo
bash repo/deploy/install.sh
```

Then record it in the infra repo:

```bash
cd /opt/infra
git add apps/raulhandyman/compose.yml proxy/nginx/conf.d/raulhandyman.conf
nano SERVER.md          # add raulhandyman.net, port 8330
git commit -m "Add raulhandyman.net static site"
```

### Updates

Push to `main`, then on the VPS:

```bash
/opt/infra/apps/raulhandyman/deploy.sh           # deploys only if main has new commits
/opt/infra/apps/raulhandyman/deploy.sh --force   # rebuild anyway
```

`deploy.sh` tags the running image as `raulhandyman-web:previous` before building. If the new container fails its health check, it restores that image and resets the repo to the previous commit.

### Useful commands

```bash
docker logs --tail 50 raulhandyman-web
curl -s http://127.0.0.1:8330/healthz
curl -I https://raulhandyman.net
openssl x509 -enddate -noout -in /opt/infra/proxy/letsencrypt/live/raulhandyman.net/fullchain.pem
```

Certificates renew through the existing `/opt/infra/shared/renew-all-certs.sh` cron job.
