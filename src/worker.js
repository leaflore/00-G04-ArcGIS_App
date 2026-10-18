import { onRequestGet } from "../functions/api/get-map-token.js";

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === "/api/get-map-token" && request.method === "GET") {
            return onRequestGet({ request, env });
        }

        // Everything else is served from the static assets binding.
        return env.ASSETS.fetch(request);
    }
};
