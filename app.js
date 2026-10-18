// app.js - Frontend Cloudflare Pages Mapping Script
const identityManager = await $arcgis.import("@arcgis/core/identity/IdentityManager");
const esriConfig = await $arcgis.import("@arcgis/core/config.js");
const SceneLayer = await $arcgis.import("@arcgis/core/layers/SceneLayer.js");
const WebTileLayer = await $arcgis.import("@arcgis/core/layers/WebTileLayer.js");
const Basemap = await $arcgis.import("@arcgis/core/Basemap.js");
const OAuthInfo = await $arcgis.import("@arcgis/core/identity/OAuthInfo.js");
const Map = await $arcgis.import("@arcgis/core/Map.js");
const SceneView = await $arcgis.import("@arcgis/core/views/SceneView.js");
const FeatureLayer = await $arcgis.import("@arcgis/core/layers/FeatureLayer.js");

async function fetchCacheToken() {
    // Using a relative path route. Cloudflare Pages Functions will map this automatically 
    // to the correct function 
    // endpoint.
    const response = await fetch('/api/get-map-token');
    if (!response.ok) {
        throw new Error(`Token handshake failed (${response.status}): ${await response.text()}`);
    }
    const data = await response.json();
    return data;
}

// Main renderApp function to initialize and render the ArcGIS map and scene view
async function renderApp() {
    // OAuth 2.0 user sign-in: redirects to ArcGIS, then returns here with a token for the signed-in user.
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

    const map = new Map({
        basemap: "arcgis/streets",
        ground: "world-elevation"
    });

    const buildings = new SceneLayer({
        portalItem: { id: "ca0470dbbddb4db28bad74ed39949e25" }
    });
    buildings.load().catch(err => console.error("3D buildings failed to load", err));
    map.add(buildings);

    map.basemap.load().catch(err => console.error("Basemap failed to load", err));
    map.basemap.baseLayers.on("after-add", ({ item }) =>
        item.load().catch(err => console.error("Basemap layer failed", item.title, err)));

    const view = new SceneView({
        container: "viewDiv",
        map: map,
        camera: {
            position: { x: -118.4911, y: 34.0194, z: 150000 }, // Over Santa Monica coast
            tilt: 65, // Tilts the camera up to turn your 2D map into a 3D perspective
            heading: 0 // Sets the direction the camera is facing, 0 is north
        }
    });

    const tooltipTemplate = {
        title: "{Name}",
        content: "{Description}"
    };

    const localFeatures = [
        {
            geometry: { type: "point", x: -118.4911, y: 34.0194 },
            attributes: { ObjectID: 1, Name: "Coastal Scenic Viewpoint", Description: "Hosted 100% on Cloudflare Pages."}
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
    map.add(poiLayer);

    view.when(() => {
        view.popup.dockOptions = { button: false, breakpoint: false };
        view.popup.collapseEnabled = false;

        view.on("pointer-move", (event) => {
            view.hitTest(event).then((response) => {
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

renderApp().catch(err => console.error("Initialization pipeline failed", err));