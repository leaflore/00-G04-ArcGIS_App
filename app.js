// app.js - Frontend Cloudflare Pages Mapping Script
const identityManager = await $arcgis.import("@arcgis/core/identity/IdentityManager");
const Map = await $arcgis.import("@arcgis/core/Map.js");
const SceneView = await $arcgis.import("@arcgis/core/views/SceneView.js");
const FeatureLayer = await $arcgis.import("@arcgis/core/layers/FeatureLayer.js");

async function fetchCacheToken() {
    // Using a relative path route. Cloudflare Pages Functions will map this automatically 
    // to the correct function 
    // endpoint.
    const response = await fetch('/api/get-map-token');
    if (!response.ok) {
        throw new Error('Cloudflare locl proxy token handshake failed.');
    }
    const data = await response.json();
    return data;
}

// Main renderApp function to initialize and render the ArcGIS map and scene view
async function renderApp() {
    const token = (await fetchCacheToken()).token;

    identityManager.registerToken({
        server: "https://www.arcgis.com/sharing/rest",
        token: token
    });

    const map = new Map({
        basemap: "arcgis/dark-gray",
        ground: "world-elevation"
    });

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