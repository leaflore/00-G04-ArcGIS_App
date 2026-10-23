// app-query-test.js - Isolated client query experiment; based on app.js - Frontend Cloudflare Pages Mapping Script

// ----- IMPORTANT: IMPORT STATEMENTS -----
const identityManager = await $arcgis.import("@arcgis/core/identity/IdentityManager");
const esriConfig = await $arcgis.import("@arcgis/core/config.js");
const SceneLayer = await $arcgis.import("@arcgis/core/layers/SceneLayer.js");
const OAuthInfo = await $arcgis.import("@arcgis/core/identity/OAuthInfo.js");
const Map = await $arcgis.import("@arcgis/core/Map.js");
const SceneView = await $arcgis.import("@arcgis/core/views/SceneView.js");
const FeatureLayer = await $arcgis.import("@arcgis/core/layers/FeatureLayer.js");




// Main renderApp function to initialize and render the ArcGIS map and scene view

// ----- IMPORTANT: BEGINNING OF APP VARIABLES AND CLASS DEFINITIONS -----

async function renderApp() {
    
    // Prefer the app-level OAuth token from the Worker; fall back to interactive OAuth sign-in if ArcGIS rejects it.
    const appAuth = await fetch('/api/get-map-token').then(r => r.json()).catch(() => ({ valid: false }));
    
    if (appAuth.valid) {
        esriConfig.apiKey = appAuth.token;
        console.log("Using app token for authentication.");

    } else {
        console.warn("App token unavailable, using sign-in:", appAuth.reason, appAuth.checkStatus ?? "");

        const { clientId } = await (await fetch('/api/oauth-config')).json();

        if (!clientId) throw new Error("ARCGIS_CLIENT_ID is not set on the Worker.");

        const sharingUrl = "https://www.arcgis.com/sharing";
        
        identityManager.registerOAuthInfos([new OAuthInfo({ appId: clientId, portalUrl: "https://www.arcgis.com" })]);
        let credential;

        try {
            credential = await identityManager.checkSignInStatus(sharingUrl);

        } catch {
            credential = await identityManager.getCredential(sharingUrl);

        }
        esriConfig.apiKey = credential.token;
    }

    // Create the map and scene view
    // ----- NOTE: Look into Map class -----
    const map = new Map({
        basemap: "arcgis/streets",
        ground: "world-elevation"
    });

    const buildings = new SceneLayer({
        portalItem: { id: "ca0470dbbddb4db28bad74ed39949e25" }
    });

    await buildings.load();
    // Only cache attributes that can be selected for statistics, plus the ID for highlighting.
    buildings.outFields = [buildings.objectIdField, ...buildings.fields
        .filter(field => ["small-integer", "integer", "single", "double", "long", "big-integer"].includes(field.type))
        .map(field => field.name)];
    map.add(buildings);

    map.basemap.load().catch(err => console.error("Basemap failed to load", err));
    map.basemap.baseLayers.on("after-add", ({ item }) =>
        item.load().catch(err => console.error("Basemap layer failed", item.title, err)));


    // ----- NOTE: Look into SceneView class -----
    // Initialize the SceneView with the map and camera settings
    const view = new SceneView({
        container: "viewDiv",
        map: map,
        camera: {
            position: { x: -118.3895, y: 34.1045, z: 1150 }, // Looking north toward Wonderland Park Avenue
            tilt: 55, // Tilts the camera up to turn your 2D map into a 3D perspective
            heading: 0 // Sets the direction the camera is facing, 0 is north
        }
    });

    // ----- IMPORT: tooltip template -----
    const tooltipTemplate = {
        title: "{Name}",
        content: "{Description}"
        // TODO: Enhance tooltip template with additional fields or formatting as needed
    };

    const localFeatures = [
        {
            geometry: { type: "point", x: -118.3895, y: 34.1148 },
            attributes: { ObjectID: 1, Name: "Wonderland Park Avenue", Description: "Wonderland Park Avenue, Los Angeles, CA. Draw a shape to query loaded buildings nearby."}
        }
    ];

    const poiLayer =  new FeatureLayer({
        source: localFeatures,
        objectIdField: "ObjectID",
        fields: [
            { name: "ObjectID", type: "oid" },
            { name: "Name", type: "string" },
            { name: "Description", type: "string" }
        ],
        popupTemplate: tooltipTemplate,
        renderer: {
            type: "simple",
            symbol: {
                type: "point-3d",
                symbolLayers: [{ type: "icon", size: 12, material: {color: "blue" }, outline: { color:"white", size: 2 }}]
            }
        }
    });

    

    // ----- ADD: 3D buildings and POI layer to the map -----
    map.add(poiLayer);

    // Research can load independently; a catalog failure must not disable building queries.
    setupResearchLayer(view, map).catch(error => {
        console.error("Research layer failed to load", error);
        document.getElementById("researchAssistantStatus").textContent = "The research map layer could not load. The research catalog can still be searched in the sidebar.";
    });
    await setupClientQueries(view, buildings);

    view.when(() => {
        view.popup.dockOptions = { button: false, breakpoint: false };
        view.popup.collapseEnabled = false;

        view.on("pointer-move", (event) => {
            if (document.querySelector("[data-tool][aria-pressed=true]")) return;
            view.hitTest(event, { include: [poiLayer] }).then((response) => {
                // Filter the hit test results to only include graphics from the POI layer
                const results = response.results.filter(r => r.type === "graphic" && r.graphic.layer === poiLayer);

                if (results.length > 0) {
                    const targetGraphic = results[0].graphic; // Get the first matching graphic
                    view.container.style.cursor = "pointer";
                    view.openPopup({ features: [targetGraphic], location: targetGraphic.geometry });

                } else {
                    view.container.style.cursor = "default";
                    if (view.popup.features?.some(feature => feature.layer === poiLayer)) view.closePopup();
                    
                }
            });
        });
    });
}

// ----- IMPORTANT: END OF APP VARIABLES AND CLASS DEFINITIONS -----

// ----- IMPORTANT: CALLING THE RENDER APP FUNCTION -----

renderApp().catch(err => {
    console.error("Initialization pipeline failed", err);
    document.getElementById("queryStatus").textContent = "Unable to initialize the test. Check authentication, network access, and the browser console, then reload.";
});
async function setupClientQueries(view, buildings) {
    const [GraphicsLayer, SketchViewModel, Graphic, bufferOperator, reactiveUtils,
        Point, webMercatorUtils, intersectionOperator] = await $arcgis.import([
        "@arcgis/core/layers/GraphicsLayer.js", "@arcgis/core/widgets/Sketch/SketchViewModel.js",
        "@arcgis/core/Graphic.js", "@arcgis/core/geometry/operators/geodesicBufferOperator.js",
        "@arcgis/core/core/reactiveUtils.js", "@arcgis/core/geometry/Point.js",
        "@arcgis/core/geometry/support/webMercatorUtils.js",
        "@arcgis/core/geometry/operators/intersectionOperator.js"
    ]);
    const el = id => document.getElementById(id);
    await view.when();
    const home = view.camera.clone();
    await buildings.load();
    const layerView = await view.whenLayerView(buildings);
    await bufferOperator.load();

    // One geodesic mile is the smallest requested neighborhood scope.
    // Keep the study area in the view's spatial reference for local intersection operations.
    const street = new Point({ longitude: -118.3895, latitude: 34.1148 });
    const geographicArea = bufferOperator.execute(street, 1609.344, { unit: "meters" });
    const studyArea = webMercatorUtils.project(geographicArea, view.spatialReference);
    if (!studyArea) throw new Error("Could not project the Wonderland study area.");
    layerView.filter = { geometry: studyArea, spatialRelationship: "intersects" };
    const studyLayer = new GraphicsLayer({ title: "Wonderland study area - 1 mile", listMode: "hide" });
    studyLayer.add(new Graphic({ geometry: studyArea, symbol: {
        type: "simple-fill", color: [0, 0, 0, 0],
        outline: { color: "#237787", width: 1.5, style: "short-dash" }
    }}));
    const bufferLayer = new GraphicsLayer({ title: "Query buffer", listMode: "hide" });
    const sketchLayer = new GraphicsLayer({ title: "Query geometry", listMode: "hide" });
    view.map.addMany([studyLayer, bufferLayer, sketchLayer]);
    const sketch = new SketchViewModel({ view, layer: sketchLayer,
        defaultCreateOptions: { hasZ: false }, defaultUpdateOptions: { tool: "reshape", toggleToolOnClick: false },
        polygonSymbol: { type: "simple-fill", color: [0,160,190,0.12], outline: { color: "#007f99", width: 2 } }
    });
    const numeric = new Set(["small-integer", "integer", "single", "double", "long", "big-integer"]);
    const fields = buildings.fields.filter(f => numeric.has(f.type) && f.name !== buildings.objectIdField);
    fields.forEach(f => el("statField").add(new Option(f.alias || f.name, f.name)));
    const height = fields.find(f => /height/i.test(f.name));
    if (height) el("statField").value = height.name;
    let geometry = null, highlight = null, revision = 0, debounceTimer, activeQuery;
    const status = message => { el("queryStatus").textContent = message; };
    function reset() {
        highlight?.remove(); highlight = null;
        ["buildingCount", "statMin", "statAvg", "statMax"].forEach(id => el(id).textContent = "—");
    }
    function invalidate() {
        revision++;
        clearTimeout(debounceTimer);
        activeQuery?.abort();
        activeQuery = null;
    }
    function clear() {
        invalidate(); geometry = null;
        sketch.cancel(); sketchLayer.removeAll(); bufferLayer.removeAll(); reset();
        el("retryQuery").disabled = true;
        status("Choose Point, Line, or Polygon to query buildings within the one-mile study area.");
    }
    function schedule() {
        invalidate();
        el("retryQuery").disabled = !geometry;
        if (!geometry) return;
        const version = revision;
        status("Preparing building query…");
        debounceTimer = setTimeout(() => run(version), 180);
    }
    async function run(version) {
        if (version !== revision || !geometry) return;
        const controller = new AbortController();
        activeQuery = controller;
        const deadline = setTimeout(() => controller.abort(), 8000);
        const started = performance.now();
        try {
            // Update our overlay BEFORE waiting. Never watch view.updating: our own
            // sketch, buffer and highlight rendering changes that flag and caused a loop.
            const distance = Number(el("bufferSize").value);
            const buffered = distance ? bufferOperator.execute(geometry, distance, { unit: "meters" }) : geometry;
            const area = intersectionOperator.execute(buffered, studyArea);
            bufferLayer.removeAll();
            if (area && distance) bufferLayer.add(new Graphic({ geometry: area, symbol: sketch.polygonSymbol }));
            if (!area) {
                reset(); el("buildingCount").textContent = "0";
                status("This shape is outside the one-mile study area. Return to the street and draw nearby.");
                return;
            }
            if (layerView.suspended) { status("Zoom in until the buildings layer is visible, then choose Retry query."); return; }
            status("Waiting for the buildings layer (up to 8 seconds)…");
            await reactiveUtils.whenOnce(() => !layerView.updating, { signal: controller.signal });
            if (version !== revision) return;
            status("Querying loaded buildings…");
            const query = layerView.createQuery();
            // createQuery incorporates the layer-view filter. Clip explicitly because
            // replacing query.geometry would otherwise replace that spatial condition.
            query.geometry = area; query.spatialRelationship = "intersects";
            query.outFields = []; query.returnGeometry = false;
            query.outStatistics = [{ onStatisticField: buildings.objectIdField, outStatisticFieldName: "selected_count", statisticType: "count" }];
            const field = el("statField").value;
            if (field) ["min", "avg", "max"].forEach(type => query.outStatistics.push({ onStatisticField: field, outStatisticFieldName: `value_${type}`, statisticType: type }));
            const idQuery = layerView.createQuery();
            idQuery.geometry = area; idQuery.spatialRelationship = "intersects";
            const options = { signal: controller.signal };
            const [result, ids] = await Promise.all([
                layerView.queryFeatures(query, options), layerView.queryObjectIds(idQuery, options)
            ]);
            if (version !== revision) return;
            if (result.exceededTransferLimit) throw new Error("Incomplete statistics returned");
            const stats = result.features[0]?.attributes || {};
            const count = Number(stats.selected_count || 0);
            el("buildingCount").textContent = count.toLocaleString();
            for (const [id, key] of [["statMin","min"], ["statAvg","avg"], ["statMax","max"]]) {
                const value = stats[`value_${key}`];
                el(id).textContent = field && count && value != null ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—";
            }
            highlight?.remove(); highlight = ids?.length ? layerView.highlight(ids) : null;
            const elapsed = ((performance.now() - started) / 1000).toFixed(1);
            status(count ? `Selection updated in ${elapsed} s from loaded buildings within one mile.`
                : "No loaded buildings intersect. Increase the buffer or zoom in, then retry.");
        } catch (error) {
            if (version !== revision) return;
            reset();
            if (controller.signal.aborted) {
                status("Buildings did not finish within 8 seconds. Zoom closer or wait for buildings to appear, then choose Retry query.");
            } else {
                console.error("Client-side query failed", error);
                status("Query failed. Try Count only and Retry query. See the console for details.");
            }
        } finally {
            clearTimeout(deadline);
            if (activeQuery === controller) activeQuery = null;
        }
    }
    const buttons = [...document.querySelectorAll("[data-tool]")];
    buttons.forEach(button => button.addEventListener("click", () => { clear(); view.closePopup(); sketch.create(button.dataset.tool); }));
    reactiveUtils.watch(() => sketch.state, state => buttons.forEach(button => button.setAttribute("aria-pressed", String(state === "active" && sketch.activeTool === button.dataset.tool))));
    sketch.on("create", event => { if (event.state === "complete") { geometry = event.graphic.geometry; schedule(); } });
    sketch.on("update", event => { if (["active", "complete"].includes(event.state)) { geometry = event.graphics[0]?.geometry || null; schedule(); } });
    el("bufferSize").addEventListener("input", () => { el("bufferValue").textContent = `${el("bufferSize").value} m`; schedule(); });
    el("statField").addEventListener("change", schedule);
    el("clearQuery").addEventListener("click", clear);
    el("retryQuery").addEventListener("click", schedule);
    el("homeQuery").addEventListener("click", () => view.goTo(home).catch(error => { if (error.name !== "AbortError") console.error(error); }));
    // Refresh only for actual camera navigation. Graphics updates must not requery.
    reactiveUtils.watch(() => view.stationary, stationary => {
        if (!geometry) return;
        if (stationary) schedule();
        else { invalidate(); status("Map moving; results will refresh when navigation stops."); }
    });
    el("queryControls").disabled = false;
    clear();
}


async function setupResearchLayer(view, map) {
    const [GeoJSONLayer, response] = await Promise.all([
        $arcgis.import("@arcgis/core/layers/GeoJSONLayer.js"),
        fetch("data/research-evidence.json", { cache: "no-cache" })
    ]);
    if (!response.ok) throw new Error(`Research catalog returned HTTP ${response.status}`);
    const corpus = await response.json();
    const layer = new GeoJSONLayer({
        url: new URL("data/wonderland-houses.geojson", window.location.href).href,
        title: "Wonderland houses - cited research",
        objectIdField: "objectid", outFields: ["*"],
        elevationInfo: { mode: "relative-to-ground", offset: 3 },
        renderer: { type: "simple", symbol: {
            type: "simple-marker", style: "circle", size: 9, color: "#d66b37",
            outline: { color: "white", width: 1.5 }
        }},
        popupTemplate: {
            title: "{house_name}",
            content: [{ type: "fields", fieldInfos: [
                { fieldName: "address", label: "Address" },
                { fieldName: "architect", label: "Index architect" },
                { fieldName: "research_architect", label: "Research attribution" },
                { fieldName: "year_text", label: "Index date" },
                { fieldName: "landscape_designer", label: "Documented landscape attribution" },
                { fieldName: "research_summary", label: "Research findings" },
                { fieldName: "record_issues", label: "Uncertainty / conflicting records" },
                { fieldName: "source_rows", label: "Original spreadsheet rows" },
                { fieldName: "location_status", label: "Map location basis" }
            ]}]
        }
    });
    map.add(layer);
    await layer.load();
    window.dispatchEvent(new CustomEvent("wonderland-research-ready", {
        detail: { view, layer, records: corpus.records, evidence: corpus.evidence, sources: corpus.sources }
    }));
}
