// Optional npm-built adapter. This module is imported only by user activation.
import "@arcgis/ai-components/components/arcgis-assistant";
import "@arcgis/ai-components/components/arcgis-assistant-agent";
import { createResearchAgent } from "./research-agent.js";
import identityManager from "@arcgis/core/identity/IdentityManager.js";
import OAuthInfo from "@arcgis/core/identity/OAuthInfo.js";
import esriConfig from "@arcgis/core/config.js";

const PORTAL = "https://www.arcgis.com";
let connected = false;

export async function enableResearchAI({ session, assistant: placeholder, executeQuery, status = () => {} }) {
    if (!placeholder) throw new Error("The research assistant element is missing");
    let assistant = placeholder;
    if (connected) { assistant.hidden = false; return; }
    esriConfig.assetsPath = "https://js.arcgis.com/5.1/@arcgis/core/assets";
    esriConfig.applicationName = "Wonderland Park Avenue Research";
    // OAuth is completed once by the shared CDN manager before this bundle loads.
    // The npm SDK receives only the resulting named-user session; it never starts
    // a competing redirect or consumes the same one-time callback a second time.
    const { credential, clientId } = session || {};
    if (!clientId || !credential?.userId || !credential?.token) {
        throw new Error("A completed ArcGIS Online user sign-in is required.");
    }
    identityManager.registerOAuthInfos([new OAuthInfo({ appId: clientId, portalUrl: PORTAL, popup: false })]);
    identityManager.registerToken({
        server: `${PORTAL}/sharing/rest`, userId: credential.userId,
        token: credential.token, expires: credential.expires, ssl: true
    });
    await customElements.whenDefined("arcgis-assistant");
    if (placeholder.localName !== "arcgis-assistant") {
        // Initial HTML uses a div so the CDN SDK cannot discover and import
        // an assistant component ahead of this npm-built custom-agent adapter.
        assistant = document.createElement("arcgis-assistant");
        for (const name of ["id", "class", "aria-label"]) {
            const value = placeholder.getAttribute(name);
            if (value) assistant.setAttribute(name, value);
        }
        assistant.hidden = true;
    }
    const agent = createResearchAgent(executeQuery);
    const wrapper = document.createElement("arcgis-assistant-agent");
    wrapper.agent = agent.registration;
    assistant.heading = "Wonderland research assistant";
    assistant.description = "Explore house records and cited landscape research.";
    assistant.entryMessage = "Ask about an address, architect, date, or research theme. Answers distinguish documented house facts from contextual readings. Missing facts are left unknown.";
    assistant.suggestedPrompts = ["Show houses by Gregory Ain", "Which houses were built before 1960?", "What does Eckbo say about social space?"];
    assistant.addEventListener("arcgisError", () => status("Esri AI could not complete the request. Check your organization's AI privileges or use local research search."));
    assistant.appendChild(wrapper);
    if (assistant !== placeholder) placeholder.replaceWith(assistant);
    if (typeof assistant.componentOnReady === "function") await assistant.componentOnReady();
    assistant.hidden = false;
    connected = true;
}
