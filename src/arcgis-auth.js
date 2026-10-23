const PORTAL = "https://www.arcgis.com";

// A single CDN IdentityManager owns OAuth callbacks for both the map and AI.
// Never import the npm AI bundle until this manager finishes the callback.
export function createArcGISAuth({ loadSDK, fetchConfig }) {
    let setup, pending;
    function configure() {
        if (!setup) {
            setup = Promise.all([loadSDK(), fetchConfig()]).then(([sdk, config]) => {
                if (!config.clientId) throw new Error("ARCGIS_CLIENT_ID is not set on the Worker.");
                sdk.identityManager.registerOAuthInfos([new sdk.OAuthInfo({
                    appId: config.clientId, portalUrl: PORTAL, popup: false
                })]);
                return { ...sdk, clientId: config.clientId };
            }).catch(error => { setup = null; throw error; });
        }
        return setup;
    }
    return function getSession({ interactive = false, beforeRedirect = () => {} } = {}) {
        if (pending) return pending;
        pending = (async () => {
            const { identityManager, clientId } = await configure();
            let credential;
            try {
                credential = await identityManager.checkSignInStatus(`${PORTAL}/sharing`);
            } catch (cause) {
                if (!interactive) {
                    const error = new Error("ArcGIS sign-in did not complete or has expired. Select Sign in or Connect Esri AI chat to try again.", { cause });
                    error.code = "ARCGIS_SIGN_IN_REQUIRED";
                    throw error;
                }
                beforeRedirect();
                credential = await identityManager.getCredential(`${PORTAL}/sharing`);
            }
            if (!credential?.userId) throw new Error("A named ArcGIS Online user account is required.");
            return { credential, clientId };
        })().finally(() => { pending = null; });
        return pending;
    };
}

export const getArcGISSession = createArcGISAuth({
    async loadSDK() {
        const [identityManager, OAuthInfo] = await globalThis.$arcgis.import([
            "@arcgis/core/identity/IdentityManager.js", "@arcgis/core/identity/OAuthInfo.js"
        ]);
        return { identityManager, OAuthInfo };
    },
    async fetchConfig() {
        const response = await fetch("/api/oauth-config", { cache: "no-store" });
        if (!response.ok) throw new Error("OAuth configuration could not load.");
        return response.json();
    }
});

// Consume the redirect intent once. An unsuccessful return must not redirect again.
export function consumeEsriIntent(storage) {
    try {
        const enabled = storage.getItem("wonderland-esri-assistant") === "enabled";
        storage.removeItem("wonderland-esri-assistant");
        return enabled;
    } catch { return false; }
}
