// app.js - Frontend Cloudflare Pages Mapping Script

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
            position: { x: -118.4911, y: 34.0194, z: 150000 }, // Over Santa Monica coast
            tilt: 65, // Tilts the camera up to turn your 2D map into a 3D perspective
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

    

    // ----- ADD: 3D buildings and POI layer to the map -----
    map.add(poiLayer);

    view.when(() => {
        view.popup.dockOptions = { button: false, breakpoint: false };
        view.popup.collapseEnabled = false;

        view.on("pointer-move", (event) => {
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

renderApp().catch(err => console.error("Initialization pipeline failed", err));