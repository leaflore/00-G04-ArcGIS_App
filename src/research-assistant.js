import { searchResearch, formatResearchAnswer, recordLabel, recordId, yearLabel, textValue, citationLabel, objectIdWhere, locationNeedsReview } from "./research-search.js";

// Native browser entry: no package imports and no LLM requests on page load.
// The optional Esri adapter is loaded only after the connect button is used.
const byId = id => document.getElementById(id);
const resultElement = byId("researchResults");
const form = byId("researchSearchForm");
const input = byId("researchQuestion");
const statusElement = byId("researchAssistantStatus");
const connectButton = byId("enableEsriAssistant");
let corpus = { records: [], evidence: [], sources: [] };
let context = null;
let latestResult = null;
let corpusReady = false;
let connecting = false;
let searchRevision = 0;

function saveEsriIntent(enabled) {
    try {
        if (enabled) sessionStorage.setItem("wonderland-esri-assistant", "enabled");
        else sessionStorage.removeItem("wonderland-esri-assistant");
    } catch { /* Local search also works when browser storage is disabled. */ }
}

function savedEsriIntent() {
    try { return sessionStorage.getItem("wonderland-esri-assistant") === "enabled"; }
    catch { return false; }
}

function loadEsriStyles() {
    if (document.querySelector('link[data-wonderland-ai-styles]')) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "/assets/research-ai.css";
        link.dataset.wonderlandAiStyles = "true";
        link.addEventListener("load", resolve, { once: true });
        link.addEventListener("error", () => {
            link.remove();
            reject(new Error("AI styles could not load; run npm run build and publish the generated assets"));
        }, { once: true });
        document.head.appendChild(link);
    });
}

function status(message) {
    if (statusElement) statusElement.textContent = message;
}

function appendText(parent, tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    parent.appendChild(element);
    return element;
}

function addAction(parent, label, action) {
    const button = appendText(parent, "button", label);
    button.type = "button";
    button.addEventListener("click", action);
    return button;
}

function publicSourceUrl(source) {
    try {
        const url = new URL(source?.url || source?.public_url || "");
        return ["https:", "http:"].includes(url.protocol) ? url.href : null;
    } catch { return null; }
}

function appendEvidence(parent, item) {
    const block = document.createElement("blockquote");
    appendText(block, "p", textValue(item.claim));
    if (item.scope) appendText(block, "p", `Evidence scope: ${textValue(item.scope).replace(/_/g, " ")}`, "research-qualification");
    if (item.qualification) appendText(block, "p", textValue(item.qualification), "research-qualification");
    const source = corpus.sources.find(source => String(source.id) === String(item.source_id));
    const url = publicSourceUrl(source);
    const cite = appendText(block, "cite", citationLabel(item, corpus.sources));
    if (url) {
        const link = appendText(cite, "a", " Open source");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
    }
    parent.appendChild(block);
}

async function showHouses(houseIds, navigate = false) {
    const { layer, view } = context || {};
    if (!layer || !view) {
        status("Research results are ready. The scene is still loading; map selection will be available when it finishes.");
        return;
    }
    // SQL is constructed only from verified numeric IDs in the catalog.
    // Search text and model output are never used as SQL or executable code.
    layer.definitionExpression = houseIds === null ? "1=1" : objectIdWhere(corpus.records, houseIds, layer.objectIdField || "objectid");
    if (!navigate || !houseIds?.length) return;
    const query = layer.createQuery();
    query.where = layer.definitionExpression;
    const result = await layer.queryExtent(query);
    if (result.extent) await view.goTo(result.extent.expand(1.5));
    else status("This catalog record has no verified map location. Its research remains searchable.");
}

function renderResults(result) {
    if (!resultElement) return;
    resultElement.replaceChildren();
    appendText(resultElement, "h3", `${result.totalHouses} matching house record${result.totalHouses === 1 ? "" : "s"}`);
    if (result.totalHouses) {
        const actions = appendText(resultElement, "div", "", "research-result-actions");
        addAction(actions, "Show matching houses", () => showHouses(result.houseIds, true).catch(mapError));
        addAction(actions, "Show all houses", () => showHouses(null).catch(mapError));
        const list = appendText(resultElement, "ol", "", "research-house-list");
        for (const match of result.houses) {
            const { record } = match;
            const item = appendText(list, "li", "");
            appendText(item, "h4", recordLabel(record));
            if (record.house_name && record.house_name !== record.address) appendText(item, "p", textValue(record.house_name));
            appendText(item, "p", `Index architect: ${textValue(record.architect) || "Not documented"} · Index date: ${yearLabel(record)}`);
            if (record.research_architect) appendText(item, "p", `Research attribution: ${textValue(record.research_architect)}`);
            if (record.landscape_designer) appendText(item, "p", `Landscape designer: ${textValue(record.landscape_designer)}`);
            if (record.research_summary) appendText(item, "p", textValue(record.research_summary));
            if (record.record_issues) appendText(item, "p", textValue(record.record_issues), "research-qualification");
            if (locationNeedsReview(record.location_status)) appendText(item, "p", `Map location: ${textValue(record.location_status) || "Not documented"}`, "research-qualification");
            const citationMatches = match.evidence.slice(0, 2);
            for (const evidence of citationMatches) appendEvidence(item, evidence);
            if (!citationMatches.length) appendText(item, "p", `Catalog source: ${textValue(record.source_rows) || "Original Wonderland house index"}.`, "research-citation");
            addAction(item, "Locate house", () => showHouses([recordId(record)], true).catch(mapError));
        }
        if (result.truncated) appendText(resultElement, "p", `Showing the first ${result.houses.length} records. Add an address, architect, or date to narrow the list.`);
    }
    const contextMatches = result.evidence.filter(item => item.contextual);
    if (contextMatches.length) {
        appendText(resultElement, "h3", "Contextual and unlinked readings");
        appendText(resultElement, "p", "These findings cover theory, neighborhood history, source notes, or properties not linked to a catalog address. They do not establish a design feature, author, or date for an individual catalog house.", "research-qualification");
        for (const item of contextMatches) appendEvidence(resultElement, item);
    }
    if (!result.totalHouses && !result.evidence.length) appendText(resultElement, "p", "No cited match found. Try a street number, architect, year, or shorter topic. Information absent from the catalog is not assumed.");
    appendText(resultElement, "p", "Search uses catalog fields and cited findings. It does not search the web or invent missing house information.", "research-qualification");
}

function mapError(error) {
    if (error?.name !== "AbortError") status("Research results are available. Map navigation could not finish; retry Locate house after the scene loads.");
}

async function runQuery(question, { filter = true } = {}) {
    if (!corpusReady) throw new Error("The research catalog is still loading. Please try again shortly.");
    const result = searchResearch(corpus, question);
    latestResult = result;
    renderResults(result);
    if (filter && result.totalHouses > 0 && context) await showHouses(result.houseIds).catch(mapError);
    return formatResearchAnswer(result);
}

function acceptCorpus(data) {
    if (!Array.isArray(data?.records)) return;
    corpus = { records: data.records, evidence: data.evidence || [], sources: data.sources || [] };
    corpusReady = true;
    status(`Search ${corpus.records.length} house records and ${corpus.evidence.length} cited findings. Local search works without an AI sign-in.`);
    if (input?.value.trim()) runQuery(input.value).catch(error => status(error.message));
}

window.addEventListener("wonderland-research-ready", event => {
    context = event.detail;
    acceptCorpus(event.detail);
    if (latestResult?.totalHouses) showHouses(latestResult.houseIds).catch(mapError);
});

form?.addEventListener("submit", async event => {
    event.preventDefault();
    const version = ++searchRevision;
    const question = input?.value.trim() || "Show all houses";
    try {
        await runQuery(question);
        if (version === searchRevision) status("Search complete. Use Show matching houses to zoom to the located records.");
    } catch (error) { if (version === searchRevision) status(error.message); }
});

async function connectEsri() {
    if (connecting || !connectButton) return;
    if (!corpusReady) {
        status("The research catalog is still loading. Connect Esri AI once local search is ready.");
        return;
    }
    let adapterLoaded = false;
    connecting = true;
    connectButton.disabled = true;
    status("Loading optional Esri AI assistant. ArcGIS Online organization sign-in is required.");
    try {
        // A boolean intent flag permits OAuth redirect/resume. No token or
        // research text is stored by this application.
        saveEsriIntent(true);
        const [adapter] = await Promise.all([import("/assets/research-ai.js"), loadEsriStyles()]);
        adapterLoaded = true;
        await adapter.enableResearchAI({
            assistant: byId("researchAssistant"),
            executeQuery: runQuery,
            status
        });
        connectButton.hidden = true;
        status("Esri AI assistant connected. Answers use the same cited research catalog as local search.");
    } catch (error) {
        saveEsriIntent(false);
        const detail = error?.message || "Unable to connect";
        if (!adapterLoaded) {
            status(`Esri AI files could not load: ${detail}. Reload the page after deployment finishes. Local research search remains available.`);
            console.error("AI asset loading failed. Build with npm run build and deploy assets/research-ai.js, its CSS, and all generated chunks.", error);
        } else {
            status(`Esri AI could not connect: ${detail}. Local research search remains available.`);
        }
        connectButton.disabled = false;
    } finally { connecting = false; }
}

connectButton?.addEventListener("click", connectEsri);

// Loading the local corpus separately avoids a failed scene/auth request
// blocking research, and avoids a race if the scene emitted its event first.
if (form) {
    fetch(new URL("../data/research-evidence.json", import.meta.url), { cache: "no-cache" })
        .then(response => {
            if (!response.ok) throw new Error(`Research catalog returned HTTP ${response.status}`);
            return response.json();
        })
        .then(data => {
            if (!corpusReady) acceptCorpus(data);
            if (savedEsriIntent()) connectEsri();
        })
        .catch(error => status(`Research catalog could not load: ${error.message}. Reload after deployment finishes.`));
}
