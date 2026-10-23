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
`package.json`, `package-lock.json`, `scripts/build-research.mjs`, the `src/research-*` modules,
`data/`, the backup, and all three query files, to the repository connected to the existing
Cloudflare Worker `fall-2026-wpa3dapp`.

Use these Cloudflare Workers Builds settings:

| Setting | Value |
| --- | --- |
| Root directory | Repository root (the folder containing `wrangler.toml`) |
| Build command | `npm run build` (compiles the optional Esri AI custom agent) |
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
cover the buildings currently loaded in the scene within a one-mile radius of
Wonderland Park Avenue. The dashed boundary shows this area. Queries wait only for
the buildings layer, cancel superseded requests, and time out after eight seconds
with a Retry query button. Camera navigation refreshes the query; rendering a
sketch, buffer, or highlight does not restart it. To view the previous app, use
the **Open original app (backup)** link.

Run the query lifecycle regression checks with `node --test tests/client-query.test.mjs`.
These checks use mocked ArcGIS objects to cover rendering feedback, timeout and retry,
late results after clearing, camera navigation, and selections outside the study area.
They do not measure live ArcGIS loading or validate a deployed Cloudflare instance.

To restore the previous homepage, copy `index-backup.html` over `index.html` and
redeploy; the original `app.js` and `styles.css` remain available.

References: [Cloudflare Static Assets configuration](https://developers.cloudflare.com/workers/static-assets/binding/)
and [Workers Builds settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).


## Research layer and assistant

The map now occupies the left column, with a persistent research search/chat panel
on the right. Building query controls are available in a collapsible drawer over
the map. The mobile layout stacks the map above the research panel.

`data/research-evidence.json` contains 63 consolidated index records and 63 cited
findings drawn from the supplied readings and the prior C.O.R.E. research corpus.
The workbook retains all 69 nonempty original index entries; six duplicate entries
are combined for the canonical table. Original index values, conflicting research
attributions, and source-specific dates remain distinct.

`data/wonderland-houses.geojson` supplies 59 located house points to the existing
3D scene. Coordinates come from exact LA County parcel situs-address matches and
represent parcel centroids. They are not surveyed building footprints. Four records
remain searchable without a map point because their addresses are unresolved.
A point FeatureLayer is appropriate for these research attributes; an actual 3D
object SceneLayer would additionally require building geometry and elevation data.

Local search is available immediately, without an AI service call. Try:

- `8941 Wonderland Park Avenue`
- `Gregory Ain before 1960`
- `C.O.R.E.` or `Tent City`
- `Eckbo aluminum` or `tree canopy`

Results distinguish source-qualified house facts from general theory, neighborhood
history, and unlocated property research. Historical landscape descriptions do not
assert that those features survive today. Current-owner names and student-researcher
names remain in the original workbook only, not in the public research catalog.
Full PDF text and local source files are not deployed as public web assets.

Choose **Connect Esri AI chat** for the optional Esri assistant. The custom
`FunctionAgent` searches the same catalog, shows citations, and can filter/navigate
the research points in the 3D scene. The built-in Data Exploration agent currently
supports 2D WebMaps, so it is not used for this SceneView app. A custom-only assistant
does not need a WebMap or its metadata embeddings.

AI activation requires named-user OAuth with the existing `ARCGIS_CLIENT_ID`, the
app URL registered as an allowed redirect URL, and organization/user access to AI
assistants and beta capabilities. An app token or API key alone cannot enable AI.
Signing into the ArcGIS website does not configure these application privileges.
Keep the original Worker runtime credentials in Cloudflare's Variables & Secrets.

Install/build/check locally with `npm ci`, `npm run build`, and `npm test`.
The build creates `assets/research-*.js` and CSS, loaded only when AI is activated.
Generated assets and `node_modules` are ignored by Git; Cloudflare must run the build
command on each deployment. The `[build]` command in `wrangler.toml` also generates these
assets for local Wrangler dev/deploy. Keep the Cloudflare Workers Builds dashboard
build command set to `npm run build`: hosted Builds does not honor Wrangler custom
build configuration. `.assetsignore` permits only the required native
research modules, compiled AI assets, data catalog, and browser app files. Worker
source and local ingestion/OCR outputs are excluded.

## Using the exported data in ArcGIS Online

The enriched workbook and import files are in `outputs/wonderland-research/` on
this computer. Add `Wonderland_Park_Houses.geojson` to ArcGIS Online as a hosted
feature layer, then add that layer to a Web Scene if you want a saved portal scene.
The app already loads the local GeoJSON directly, so publishing is optional.
The CSV includes all 63 records and explicit latitude/longitude columns; review the
four records without coordinates before attempting to map them. Do not substitute
zero coordinates for those records.

For hosted-layer metadata, use the field descriptions in
`outputs/wonderland-research/field-dictionary.csv`. `source_ids` and `evidence_ids`
join house records to the workbook's Source Inventory and Research Evidence tabs.
The workbook's original Sheet1 columns A:I remain intact, with new fields added to
the right. A separate backup beside the original spreadsheet preserves the initial
file before enrichment.

Validation includes preservation of original spreadsheet values, GIS coordinate
checks, rendered workbook reviews, browser search/layout checks, and query/agent
regression tests. The actual FunctionAgent is tested without an LLM request;
end-to-end AI interaction still requires your named-user organization session.

Esri references: [custom agents](https://developers.arcgis.com/javascript/latest/agentic-apps/ai-custom-agents/),
[AI access requirements](https://developers.arcgis.com/javascript/latest/agentic-apps/ai-faq/),
and [Data Exploration scope](https://developers.arcgis.com/javascript/latest/references/ai-components/components/arcgis-assistant-data-exploration-agent/).

## Troubleshooting missing AI files

If Connect Esri AI reports a dynamic import error for `/assets/research-ai.js`,
check that URL in the browser Network panel. A 404 means the AI bundle is missing
from the deployment; it does not establish an ArcGIS account-permissions problem.
Ensure the Cloudflare build command is `npm run build`, then deploy again.
The deployment must include `assets/research-ai.js`, `assets/research-ai.css`,
and all generated `assets/research-chunk-*.js` files. These are generated from
Git-tracked sources during the build and intentionally are not committed.
After a successful deployment, reload the page before retrying Connect Esri AI.

Cloudflare documents the hosted-build limitation in its
[Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).
