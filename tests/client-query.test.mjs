import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app-query-test.js", import.meta.url), "utf8");
const setupSource = source.slice(source.indexOf("async function setupClientQueries("));

async function harness({ updating = false, delayQueries = false } = {}) {
    let time = 0, nextTimer = 0, sketch;
    const timers = new Map(), watchers = [], pending = [], statsCalls = [], idCalls = [];
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, {
            textContent: "", disabled: false, value: id === "bufferSize" ? "100" : "",
            handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; },
            add() {}, setAttribute() {}
        });
        return elements.get(id);
    };
    function flushWatches() {
        for (const watch of watchers) {
            const next = watch.get();
            if (next !== watch.last) { watch.last = next; watch.callback(next); }
        }
    }
    const view = {
        stationary: true, spatialReference: { wkid: 3857 }, camera: { clone: () => ({}) },
        when: async () => {}, whenLayerView: async () => layerView,
        closePopup() {}, goTo: async () => {},
        map: { addMany() {} },
        // Regression trap: the entire scene's rendering state must never gate queries.
        get updating() { throw new Error("Query accessed global view.updating"); }
    };
    const result = { features: [{ attributes: { selected_count: 3, value_min: 4, value_avg: 8, value_max: 12 } }] };
    const layerView = {
        updating, suspended: false,
        createQuery: () => ({ geometry: { source: "filter" }, outFields: ["*"] }),
        queryFeatures(query, options) {
            statsCalls.push(query);
            if (!delayQueries) return Promise.resolve(result);
            // Deliberately allow a stale query to finish despite cancellation.
            return new Promise(resolve => pending.push(() => resolve(result)));
        },
        queryObjectIds(query) { idCalls.push(query); return Promise.resolve([1, 2, 3]); },
        highlight() { flushWatches(); return { remove: flushWatches }; }
    };
    class GraphicsLayer {
        add() { flushWatches(); }
        removeAll() { flushWatches(); }
    }
    class Sketch {
        constructor() { sketch = this; this.handlers = {}; this.state = "ready"; }
        on(event, callback) { this.handlers[event] = callback; }
        cancel() {}
        create() {}
    }
    const reactive = {
        watch(get, callback) { watchers.push({ get, callback, last: get() }); },
        whenOnce(get, { signal }) {
            if (get()) return Promise.resolve();
            return new Promise((resolve, reject) => {
                const watcher = { get, last: false, callback(value) { if (value) resolve(); } };
                watchers.push(watcher);
                signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            });
        }
    };
    const modules = [GraphicsLayer, Sketch, class { constructor(props) { Object.assign(this, props); } },
        { load: async () => {}, execute: (geometry, distance) => ({ geometry, distance }) }, reactive,
        class { constructor(props) { Object.assign(this, props); } },
        { project: () => ({ type: "polygon", source: "one-mile-study-area" }) },
        { execute: (shape, boundary) => shape.outside ? null : ({ type: "polygon", shape, boundary, clipped: true }) }
    ];
    const context = vm.createContext({
        $arcgis: { import: async () => modules },
        document: { getElementById: element, querySelectorAll: () => [] },
        Option: class {}, AbortController, console,
        performance: { now: () => time },
        setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, at: time + delay }); return id; },
        clearTimeout(id) { timers.delete(id); }
    });
    vm.runInContext(setupSource, context);
    await context.setupClientQueries(view, {
        load: async () => {}, objectIdField: "OBJECTID",
        fields: [{ name: "height", type: "double" }]
    });
    const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
    async function advance(ms) {
        const end = time + ms;
        while (true) {
            const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a,b) => a[1].at-b[1].at)[0];
            if (!due) break;
            const [id, timer] = due; timers.delete(id); time = timer.at; timer.fn(); await flush();
        }
        time = end; await flush();
    }
    return { element, view, layerView, statsCalls, idCalls, pending, advance, flush, flushWatches,
        draw(geometry = { type: "polygon" }) { sketch.handlers.create({ state: "complete", graphic: { geometry } }); }
    };
}

test("statistics complete while global rendering changes; overlays do not restart the query", async () => {
    const app = await harness();
    app.draw(); await app.advance(180);
    assert.equal(app.element("buildingCount").textContent, "3");
    assert.equal(app.element("statAvg").textContent, "8");
    assert.equal(app.statsCalls.length, 1);
    assert.equal(app.idCalls.length, 1);
    assert.equal(app.statsCalls[0].geometry.clipped, true);
    assert.equal(app.statsCalls[0].geometry, app.idCalls[0].geometry);
    assert.equal(app.layerView.filter.geometry.source, "one-mile-study-area");
    app.flushWatches(); await app.advance(2000);
    assert.equal(app.statsCalls.length, 1, "buffer/highlight updates must not schedule another query");
});

test("persistent building loading times out and Retry succeeds after loading", async () => {
    const app = await harness({ updating: true });
    app.draw(); await app.advance(180);
    assert.match(app.element("queryStatus").textContent, /Waiting for the buildings layer/);
    await app.advance(8000);
    assert.match(app.element("queryStatus").textContent, /did not finish within 8 seconds/);
    assert.equal(app.element("retryQuery").disabled, false);
    assert.equal(app.statsCalls.length, 0);
    app.layerView.updating = false; app.flushWatches();
    app.element("retryQuery").handlers.click(); await app.advance(180);
    assert.equal(app.element("buildingCount").textContent, "3");
});

test("clearing invalidates a late query and leaves the selection empty", async () => {
    const app = await harness({ delayQueries: true });
    app.draw(); await app.advance(180);
    app.element("clearQuery").handlers.click();
    app.pending[0](); await app.flush();
    assert.equal(app.element("buildingCount").textContent, "—");
    assert.match(app.element("queryStatus").textContent, /Choose Point/);
    assert.equal(app.element("retryQuery").disabled, true);
});

test("camera navigation refreshes once after it stops", async () => {
    const app = await harness();
    app.draw(); await app.advance(180);
    app.view.stationary = false; app.flushWatches();
    await app.advance(500); assert.equal(app.statsCalls.length, 1);
    app.view.stationary = true; app.flushWatches();
    await app.advance(180); assert.equal(app.statsCalls.length, 2);
});

test("geometry outside the study area returns zero without running a query", async () => {
    const app = await harness();
    app.element("bufferSize").value = "0";
    app.draw({ type: "polygon", outside: true }); await app.advance(180);
    assert.equal(app.element("buildingCount").textContent, "0");
    assert.equal(app.statsCalls.length, 0);
    assert.match(app.element("queryStatus").textContent, /outside the one-mile study area/);
});
