// worker.js - Cloudflare Worker for handling ArcGIS app token and OAuth configuration

// ----- IMPORTANT: BEGINNING OF EXPORT WORKER FUNCTIONS -----
async function getAppToken(env) {
    const clientId = env.ARCGIS_CLIENTTWO ?? env.ARCGIS_CLIENT_ID;
    const clientSecret = env.ARCGIS_CLIENT_SECRETTWO ?? env.ARCGIS_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        return { valid: false, reason: "ARCGIS_CLIENTTWO or ARCGIS_CLIENT_SECRETTWO is not set" };
    }

    const res = await fetch("https://www.arcgis.com/sharing/rest/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "client_credentials",
            f: "json"
        })
    });
    const data = await res.json();
    if (!data.access_token) {
        return { valid: false, reason: data.error?.message ?? "ArcGIS returned no access_token" };
    }

    // Only hand the token to the browser if ArcGIS accepts it for the basemap service.
    const check = await fetch(
        `https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/arcgis/streets?type=style&token=${encodeURIComponent(data.access_token)}`
    );
    if (!check.ok) {
        // Temporary diagnostics: which ArcGIS services accept this app token? (statuses only, no token)
        const probe = async (label, url, headers) => {
            const r = await fetch(url, { headers });
            const body = await r.text();
            let msg = "ok-body";
            try {
                const e = JSON.parse(body).error;
                if (e) msg = `error ${e.code}: ${e.message}`;
            } catch { /* non-JSON body */ }
            return `${label}: ${r.status} ${msg}`;
        };
        const t = encodeURIComponent(data.access_token);
        const bearer = { Authorization: `Bearer ${data.access_token}` };
        const probes = await Promise.all([
            probe("portals/self?token", `https://www.arcgis.com/sharing/rest/portals/self?f=json&token=${t}`),
            probe("basemap?token", `https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/arcgis/streets?type=style&token=${t}`),
            probe("basemap bearer", "https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/arcgis/streets?type=style", bearer),
            probe("geocode?token", `https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&singleLine=Redlands&token=${t}`),
            probe("tokenInfo", `https://www.arcgis.com/sharing/rest/community/self?f=json&token=${t}`)
        ]);
        return {
            valid: false,
            reason: "Basemap service rejected the app token",
            checkStatus: check.status,
            credentialSource: env.ARCGIS_CLIENTTWO ? "CLIENTTWO" : "original",
            tokenShape: `${data.access_token.length} chars, starts ${data.access_token.slice(0, 4)}`,
            expires_in: data.expires_in,
            probes
        };
    }
    return { valid: true, token: data.access_token, expires_in: data.expires_in };
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === "/api/get-map-token" && request.method === "GET") {
            const result = await getAppToken(env);
            return Response.json(result, { headers: { "Cache-Control": "no-store" } });
        }

        // The client ID is public by design; the secret never leaves the Worker.
        if (url.pathname === "/api/oauth-config" && request.method === "GET") {
            return Response.json({ clientId: env.ARCGIS_CLIENT_ID ?? null });
        }

        // Everything else is served from the static assets binding.
        return env.ASSETS.fetch(request);
    }
};
