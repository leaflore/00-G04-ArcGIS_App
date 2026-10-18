/**
 *  get-map-token.js - Cloudflare Page Function Proxy Route
 */

export async function onRequestGet(context) {
    try {
        // 1. Pull secure keys from the Cloudflare Pages context environment block
        const clientId = context.env.ARCGIS_CLIENT_ID;
        const clientSecret = context.env.ARCGIS_CLIENT_SECRET;
    
        // 2. Read secure keys stored directly inside the Cloudfare Dashboard environment variables
        const params = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials'
        });

        // 3. Fetch a fresh authorization token from Esri
        const response = await fetch("https://www.arcgis.com/sharing/rest/oauth2/token", {
            method: "POST",
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });

        const data = await response.json();

        console.log("ArcGIS response:", data);
        if (!response.ok || !data.access_token) {
            return new Response(JSON.stringify({ error: "ArcGIS authentication failed." }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }

        // 4. Return the token, caching it on the user's browswer for 115 minutes
        return new Response(JSON.stringify({ token: data.access_token }), {
            status: 200,
            headers: { 
                'Content-Type': 'application/json',
                "Cache-Control": "private, max-age=6900"
            },
        });

    // Catch any unexpected errors
    } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "https://leaflore.github.io/00-G04-ArcGIS_App/"
                }
            });
        }
};