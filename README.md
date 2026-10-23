# 00-G04-ArcGIS_App

A 3D ArcGIS web app hosted with Cloudflare Workers and Static Assets.
The homepage now opens the Wonderland Park Avenue client-side query version.

## App files

- `index.html` loads `app-query-test.js` and `styles-query-test.css`, including the query controls.
- `index-query-test.html` remains an alternate entry point to the same query version.
- `index-backup.html` is an exact copy of the previous homepage and still loads the original `app.js` and `styles.css`.
- `src/worker.js` handles `/api/get-map-token` and `/api/oauth-config` on the server.
- `wrangler.toml` deploys the Worker and serves the browser files through the `ASSETS` binding.
- `.assetsignore` limits the public static files to the app pages, scripts, and styles.

The browser script uses same-origin `/api/...` requests, so no Worker URL or browser
script tag for `worker.js` is required. Opening the HTML directly from disk or hosting
it on GitHub Pages alone does not run the Worker endpoints.

## GitHub to Cloudflare

Push the project files, including `.assetsignore`, `src/worker.js`, `wrangler.toml`,
the backup, and all three query files, to the repository connected to the existing
Cloudflare Worker `fall-2026-wpa3dapp`.

Use these Cloudflare Workers Builds settings:

| Setting | Value |
| --- | --- |
| Root directory | Repository root (the folder containing `wrangler.toml`) |
| Build command | Leave empty; the app has no compilation step |
| Deploy command | `npx wrangler deploy` |

This configuration deploys a Worker with Static Assets. A Pages-only static upload
does not execute `src/worker.js`.

Keep the existing ArcGIS values in the Worker's **Settings > Variables & Secrets**
for runtime use. The Worker reads `ARCGIS_CLIENT_ID` and `ARCGIS_CLIENT_SECRET`;
the optional `ARCGIS_CLIENTTWO` and `ARCGIS_CLIENT_SECRETTWO` override the app-token
credentials. Interactive sign-in still uses `ARCGIS_CLIENT_ID`. Store client secrets
as Cloudflare secrets. The ArcGIS OAuth application's allowed redirect URLs must
include the URL used for sign-in if interactive authentication is needed.

After Cloudflare deploys the commit, open the Worker/custom-domain homepage. Check
that the scene loads and the drawing buttons enable, draw a point or polygon, then
change the buffer and confirm the building count and highlights refresh. Statistics
cover the buildings currently loaded in the scene. To view the previous app, use
the **Open original app (backup)** link.

To restore the previous homepage, copy `index-backup.html` over `index.html` and
redeploy; the original `app.js` and `styles.css` remain available.

References: [Cloudflare Static Assets configuration](https://developers.cloudflare.com/workers/static-assets/binding/)
and [Workers Builds settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).
