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
        portalItem: { id: "ca0470dbbddb4db28bad74ed39949e25" },
        outFields: ["*"]
    });

    buildings.load().catch(err => console.error("3D buildings failed to load", err));
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

    await setupClientQueries(view, buildings);

    view.when(() => {
        view.popup.dockOptions = { button: false, breakpoint: false };
        view.popup.collapseEnabled = false;

        view.on("pointer-move", (event) => {
            if (document.querySelector("[data-tool][aria-pressed=true]")) return;
            view.hitTest(event).then((response) => {
                // Filter the hit test results to only include graphics from the POI layer
                const results = response.results.filter(r => r.type === "graphic" && r.graphic.layer === poiLayer);

                if (results.length > 0) {
                    const targetGraphic = results[0].graphic; // Get the first matching graphic
                    view.container.style.cursor = "pointer";
                    view.openPopup({ features: [targetGraphic], location: targetGraphic.geometry });

                } else {
                    view.container.style.cursor = "default";
                    view.closePopup();
                    
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
    const [GraphicsLayer, SketchViewModel, Graphic, bufferOperator, reactiveUtils] = await $arcgis.import([
        "@arcgis/core/layers/GraphicsLayer.js", "@arcgis/core/widgets/Sketch/SketchViewModel.js",
        "@arcgis/core/Graphic.js", "@arcgis/core/geometry/operators/geodesicBufferOperator.js", "@arcgis/core/core/reactiveUtils.js"
    ]);
    const el = id => document.getElementById(id);
    await view.when();
    const home = view.camera.clone();
    await buildings.load();
    const layerView = await view.whenLayerView(buildings);
    await bufferOperator.load();
    const bufferLayer = new GraphicsLayer({ title: "Query buffer" });
    const sketchLayer = new GraphicsLayer({ title: "Query geometry" });
    view.map.addMany([bufferLayer, sketchLayer]);
    const sketch = new SketchViewModel({ view, layer: sketchLayer,
        defaultCreateOptions: { hasZ: false }, defaultUpdateOptions: { tool: "reshape", toggleToolOnClick: false },
        polygonSymbol: { type: "simple-fill", color: [0,160,190,0.12], outline: { color: "#007f99", width: 2 } }
    });
    // Discover LA attributes; the Helsinki example's year/material fields may not exist here.
    const numeric = new Set(["small-integer", "integer", "single", "double", "long", "big-integer"]);
    const fields = buildings.fields.filter(f => numeric.has(f.type) && f.name !== buildings.objectIdField);
    fields.forEach(f => el("statField").add(new Option(f.alias || f.name, f.name)));
    const height = fields.find(f => /height/i.test(f.name));
    if (height) el("statField").value = height.name;
    let geometry = null, highlight = null, revision = 0, timer;
    const reset = () => {
        highlight?.remove(); highlight = null;
        ["buildingCount", "statMin", "statAvg", "statMax"].forEach(id => el(id).textContent = "—");
    };
    function clear() {
        revision++; clearTimeout(timer); geometry = null;
        sketch.cancel(); sketchLayer.removeAll(); bufferLayer.removeAll(); reset();
        el("queryStatus").textContent = "Choose Point, Line, or Polygon to start a query.";
    }
    function schedule() {
        const version = ++revision;
        clearTimeout(timer); reset();
        if (!geometry) return;
        el("queryStatus").textContent = "Waiting for loaded buildings…";
        timer = setTimeout(() => run(version), 180);
    }
    async function run(version) {
        try {
            await reactiveUtils.whenOnce(() => !view.updating && !layerView.updating);
            if (version !== revision || !geometry) return;
            if (layerView.suspended) { el("queryStatus").textContent = "Zoom in until the buildings layer is visible."; return; }
            const distance = Number(el("bufferSize").value);
            const area = distance ? bufferOperator.execute(geometry, distance, { unit: "meters" }) : geometry;
            bufferLayer.removeAll();
            if (distance) bufferLayer.add(new Graphic({ geometry: area, symbol: sketch.polygonSymbol }));
            const query = layerView.createQuery();
            query.geometry = area; query.spatialRelationship = "intersects"; query.returnGeometry = false;
            query.outStatistics = [{ onStatisticField: buildings.objectIdField, outStatisticFieldName: "selected_count", statisticType: "count" }];
            const field = el("statField").value;
            if (field) ["min", "avg", "max"].forEach(type => query.outStatistics.push({ onStatisticField: field, outStatisticFieldName: `value_${type}`, statisticType: type }));
            const idQuery = layerView.createQuery();
            idQuery.geometry = area; idQuery.spatialRelationship = "intersects";
            const [result, ids] = await Promise.all([layerView.queryFeatures(query), layerView.queryObjectIds(idQuery)]);
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
            el("queryStatus").textContent = count ? "Selection updated from buildings loaded in this scene." : "No loaded buildings intersect. Increase the buffer or zoom in.";
        } catch (error) {
            if (version !== revision) return;
            reset(); console.error("Client-side query failed", error);
            el("queryStatus").textContent = "Query failed. Try Count only or zoom in. Check the console for layer/query support details.";
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
    el("homeQuery").addEventListener("click", () => view.goTo(home).catch(error => { if (error.name !== "AbortError") console.error(error); }));
    reactiveUtils.watch(() => view.updating || layerView.updating, updating => {
        if (!geometry) return;
        if (updating) { revision++; reset(); el("queryStatus").textContent = "Scene updating; waiting to refresh results…"; }
        else schedule();
    });
    el("queryControls").disabled = false;
    clear();
}
