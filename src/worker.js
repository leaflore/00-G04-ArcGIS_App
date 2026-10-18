import { onRequestGet } from "../functions/api/get-map-token.js";

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === "/api/get-map-token" && request.method === "GET") {
            return onRequestGet({ request, env });
        }

        // The client ID is public by design; the secret never leaves the Worker.
        if (url.pathname === "/api/oauth-config" && request.method === "GET") {
            return Response.json({ clientId: env.ARCGIS_CLIENT_ID ?? null });
        }

        // Everything else is served from the static assets binding.
        return env.ASSETS.fetch(request);
    }
};
