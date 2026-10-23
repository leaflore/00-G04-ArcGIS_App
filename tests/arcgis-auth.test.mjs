import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createArcGISAuth, consumeEsriIntent } from "../src/arcgis-auth.js";

const credential = { userId: "test-user", token: "test-only-token", expires: Date.now() + 60000 };
function authHarness({ check = async () => credential } = {}) {
    const calls = { checks: 0, prompts: 0, configs: 0, registrations: 0 };
    const getSession = createArcGISAuth({
        loadSDK: async () => ({
            OAuthInfo: class { constructor(options) { Object.assign(this, options); } },
            identityManager: {
                registerOAuthInfos() { calls.registrations++; },
                async checkSignInStatus() { calls.checks++; return check(); },
                async getCredential() { calls.prompts++; return credential; }
            }
        }),
        fetchConfig: async () => { calls.configs++; return { clientId: "test-client" }; }
    });
    return { getSession, calls };
}
const notSignedIn = async () => { throw new Error("callback or session unavailable"); };

test("failed callback on page load never starts another OAuth redirect", async () => {
    const { getSession, calls } = authHarness({ check: notSignedIn });
    await assert.rejects(getSession(), { code: "ARCGIS_SIGN_IN_REQUIRED" });
    await assert.rejects(getSession(), { code: "ARCGIS_SIGN_IN_REQUIRED" });
    assert.equal(calls.prompts, 0);
    assert.equal(calls.configs, 1);
});

test("explicit retry can sign in after a failed automatic resume", async () => {
    const { getSession, calls } = authHarness({ check: notSignedIn });
    await assert.rejects(getSession());
    let intents = 0;
    const session = await getSession({ interactive: true, beforeRedirect: () => intents++ });
    assert.equal(session.credential, credential);
    assert.equal(calls.prompts, 1);
    assert.equal(intents, 1);
});

test("map and AI share one pending callback exchange and one configuration", async () => {
    let finish;
    const { getSession, calls } = authHarness({ check: () => new Promise(resolve => { finish = resolve; }) });
    const map = getSession();
    const ai = getSession();
    assert.equal(map, ai);
    await new Promise(resolve => setImmediate(resolve));
    finish(credential);
    assert.equal((await map).credential, credential);
    assert.equal((await ai).credential, credential);
    assert.equal(calls.checks, 1);
    assert.equal(calls.registrations, 1);
    assert.equal(calls.prompts, 0);
});

test("successful callback does not create another redirect intent", async () => {
    const { getSession, calls } = authHarness();
    await getSession({ interactive: true, beforeRedirect() { assert.fail("unexpected redirect"); } });
    assert.equal(calls.prompts, 0);
});

function storageWithIntent() {
    const values = new Map([["wonderland-esri-assistant", "enabled"]]);
    return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test("legacy AI intent is consumed once across reloads, even after failure", () => {
    const storage = storageWithIntent();
    assert.equal(consumeEsriIntent(storage), true);
    assert.equal(consumeEsriIntent(storage), false);
    assert.equal(consumeEsriIntent({ getItem() { throw new Error("storage disabled"); } }), false);
});

const sidebarSource = await readFile(new URL("../src/research-assistant.js", import.meta.url), "utf8");
async function sidebarHarness({ getSession, storage = storageWithIntent() }) {
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, {
            value: "", textContent: "", disabled: false, hidden: false, dataset: {}, handlers: {},
            addEventListener(name, handler) { this.handlers[name] = handler; }
        });
        return elements.get(id);
    };
    const adapters = [];
    // Replace only module loading; execute the production event/redirect logic.
    const source = sidebarSource.replace(/^import .*;\n/gm, "")
        .replace('import("/assets/research-ai.js")', 'loadAdapter()');
    const context = vm.createContext({
        getArcGISSession: getSession, consumeEsriIntent, sessionStorage: storage,
        document: {
            getElementById: element, querySelector: () => null,
            createElement: () => element("style-link"),
            head: { appendChild(link) { link.handlers.load(); } }
        },
        window: { addEventListener() {} }, console,
        async loadAdapter() {
            adapters.push("loaded");
            return { async enableResearchAI(options) { adapters.push(options.session); } };
        }
    });
    // Corpus loading uses import.meta.url; drive the same ready event state here
    // to keep this test focused on login, not catalog fetch implementation.
    const beforeFetch = source.slice(0, source.indexOf('\nif (form) {'));
    vm.runInContext(beforeFetch + '\nacceptCorpus({ records: [] }); if (resumeEsri) connectEsri();', context);
    await new Promise(resolve => setImmediate(resolve));
    return { elements, adapters, storage, click: () => elements.get("enableEsriAssistant").handlers.click() };
}

test("sidebar stops failed OAuth return and only resumes after another click", async () => {
    const { getSession, calls } = authHarness({ check: notSignedIn });
    const ui = await sidebarHarness({ getSession });
    assert.equal(calls.prompts, 0);
    assert.equal(ui.adapters.length, 0);
    assert.equal(ui.storage.getItem("wonderland-esri-assistant"), undefined);
    assert.equal(ui.elements.get("enableEsriAssistant").disabled, false);
    assert.match(ui.elements.get("researchAssistantStatus").textContent, /sign-in did not complete/i);
    await ui.click();
    assert.equal(calls.prompts, 1);
    assert.equal(ui.adapters[1].credential, credential);
    assert.equal(ui.elements.get("enableEsriAssistant").hidden, true);
});

test("sidebar loads the npm AI bundle only after shared OAuth callback completes", async () => {
    let finish;
    const { getSession } = authHarness({ check: () => new Promise(resolve => { finish = resolve; }) });
    const ui = await sidebarHarness({ getSession });
    assert.equal(ui.adapters.length, 0);
    finish(credential);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ui.adapters[1].credential, credential);
    assert.equal(ui.elements.get("enableEsriAssistant").hidden, true);
});
