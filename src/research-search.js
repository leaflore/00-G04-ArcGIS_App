// Pure, deterministic retrieval shared by the public search and the Esri agent.
// Only evidence explicitly linked by house_id is treated as a property claim.
const STOP_WORDS = new Set("a an and are as at be been by can could did do does for from give has have how i in is it list me of on or please record records research search show tell that the their these this to was were what when where which who with would find house houses home homes building buildings about all built year years".split(" "));
const DISPLAY_FIELDS = ["address", "house_name", "architect", "research_architect", "year_text", "original_owner", "contractor", "landscape_designer", "research_topics", "research_summary"];

export function normalizeText(value) {
    return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeAddress(value) {
    const streetTypes = { ave: "avenue", av: "avenue", ln: "lane", dr: "drive", rd: "road", st: "street", blvd: "boulevard", ct: "court", pl: "place" };
    return normalizeText(value).split(" ").map(word => streetTypes[word] || word).join(" ");
}

export function locationNeedsReview(value) {
    const status = textValue(value);
    return /not located|unlocated|withheld|ambiguous|unverified|not verified/i.test(status)
        || !/verified|geocoded|located|exact/i.test(status);
}

export function textValue(value) {
    return Array.isArray(value) ? value.map(textValue).filter(Boolean).join("; ") : value == null ? "" : String(value);
}

export function recordId(record) {
    return textValue(record.house_id);
}

export function recordLabel(record) {
    return textValue(record.address || record.house_name || record.house_id || "House record");
}

export function yearLabel(record) {
    if (record.year_text) return textValue(record.year_text);
    if (record.year_min && record.year_max && Number(record.year_min) !== Number(record.year_max)) return `${record.year_min}–${record.year_max}`;
    return textValue(record.year_min || record.year_max) || "Not documented";
}

function arrayValue(value) {
    if (Array.isArray(value)) return value.map(String);
    return value == null || value === "" ? [] : String(value).split(/[;,|]/).map(item => item.trim()).filter(Boolean);
}

function evidenceHouseIds(evidence) {
    // Contextual theory remains contextual even if a malformed input links it.
    if (/context|general|theor/i.test(textValue(evidence.scope))) return [];
    return arrayValue(evidence.house_ids);
}

export function citationLabel(evidence, sources = []) {
    const source = sources.find(item => String(item.id) === String(evidence.source_id));
    const title = textValue(source?.title || evidence.source_id || "Unidentified source");
    const pages = textValue(evidence.pages);
    const locator = textValue(evidence.locator);
    return `${title}${pages ? `, p. ${pages}` : ""}${locator ? `, ${locator}` : ""} [${evidence.id || "evidence"}]`;
}

function tokensFor(query) {
    return [...new Set(normalizeText(query).split(" ").filter(token => token && !STOP_WORDS.has(token)))];
}

function tokenScore(tokens, value) {
    const text = ` ${normalizeText(value)} `;
    return tokens.reduce((score, token) => score + (text.includes(` ${token} `) ? 2 : token.length > 3 && text.includes(token) ? 1 : 0), 0);
}

function yearRange(record) {
    const min = Number(record.year_min);
    const max = Number(record.year_max || record.year_min);
    if (min >= 1700 && min <= 2100 && max >= min && max <= 2100) return { min, max };
    const match = textValue(record.year_text).match(/\b(?:18|19|20)\d{2}\b/g);
    return match?.length ? { min: Math.min(...match.map(Number)), max: Math.max(...match.map(Number)) } : null;
}

function parseYearConstraint(query) {
    const normalized = normalizeText(query);
    let match = normalized.match(/\bbetween\s+((?:18|19|20)\d{2})\s+(?:and\s+)?((?:18|19|20)\d{2})\b/);
    if (match) return { min: Math.min(Number(match[1]), Number(match[2])), max: Math.max(Number(match[1]), Number(match[2])) };
    match = normalized.match(/\b(before|after|since|until|during|in|from|year)\s+((?:18|19|20)\d{2})\b/);
    if (!match) return null;
    const year = Number(match[2]);
    if (match[1] === "before") return { min: 1700, max: year - 1 };
    if (match[1] === "after") return { min: year + 1, max: 2100 };
    if (match[1] === "since" || match[1] === "from") return { min: year, max: 2100 };
    if (match[1] === "until") return { min: 1700, max: year };
    return { min: year, max: year };
}

function isContextual(evidence) {
    return evidenceHouseIds(evidence).length === 0;
}

export function searchResearch(corpus = {}, query = "", { limit = 25, evidenceLimit = 8 } = {}) {
    const records = Array.isArray(corpus.records) ? corpus.records : [];
    const evidence = Array.isArray(corpus.evidence) ? corpus.evidence : [];
    const sources = Array.isArray(corpus.sources) ? corpus.sources : [];
    const cleanQuery = String(query).trim().slice(0, 1500);
    const tokens = tokensFor(cleanQuery);
    const yearConstraint = parseYearConstraint(cleanQuery);
    // A known street number is an exact constraint, preventing a nearby house
    // with similar metadata from being offered as the requested address.
    const requestedAddresses = [...new Set((cleanQuery.match(/\b\d{3,6}\b/g) || [])
        .filter(number => records.some(record => normalizeText(record.address).split(" ")[0] === number)))];
    // Street numbers repeat across Wonderland Park Avenue and nearby streets.
    // A supplied known full address takes precedence over the number alone.
    const normalizedAddressQuery = ` ${normalizeAddress(cleanQuery)} `;
    const requestedFullAddresses = new Set(records.map(record => normalizeAddress(record.address))
        .filter(address => address && normalizedAddressQuery.includes(` ${address} `)));
    const allQuery = !tokens.length || /^(?:count|how many|list|show)?\s*(?:all\s*)?(?:of the\s*)?(?:houses|homes|records|house records)?[?.! ]*$/i.test(cleanQuery);
    const queryYears = yearConstraint ? tokens.filter(token => !/^(?:18|19|20)\d{2}$/.test(token) && !["before", "after", "since", "until", "between", "during"].includes(token)) : tokens;
    const scoredEvidence = evidence.map(item => ({
        ...item,
        source: sources.find(source => String(source.id) === String(item.source_id)),
        score: tokenScore(tokens, [item.claim, textValue(item.topics), citationLabel(item, sources)].join(" ")),
        contextual: isContextual(item)
    }));
    const matches = records.flatMap(record => {
        if (requestedFullAddresses.size && !requestedFullAddresses.has(normalizeAddress(record.address))) return [];
        if (requestedAddresses.length && !requestedAddresses.includes(normalizeText(record.address).split(" ")[0])) return [];
        const range = yearRange(record);
        // Require the complete recorded year/range to satisfy the constraint.
        if (yearConstraint && (!range || range.min < yearConstraint.min || range.max > yearConstraint.max)) return [];
        const linked = scoredEvidence.filter(item => evidenceHouseIds(item).includes(recordId(record)));
        const matchedFields = DISPLAY_FIELDS.filter(field => tokenScore(queryYears, textValue(record[field])) > 0);
        const score = DISPLAY_FIELDS.reduce((total, field) => total + tokenScore(queryYears, textValue(record[field])) * (["address", "architect", "research_architect", "house_name", "landscape_designer"].includes(field) ? 3 : 1), 0)
            + linked.reduce((total, item) => total + item.score, 0);
        if (!allQuery && !score && !requestedAddresses.length && !(yearConstraint && !queryYears.length)) return [];
        return [{ record, score, matchedFields, evidence: linked.sort((a, b) => b.score - a.score) }];
    }).sort((a, b) => b.score - a.score || recordLabel(a.record).localeCompare(recordLabel(b.record), undefined, { numeric: true }));
    const houseIds = matches.map(match => recordId(match.record)).filter(Boolean);
    const documentMatches = scoredEvidence.filter(item => item.score > 0 && (!requestedAddresses.length || item.contextual || evidenceHouseIds(item).some(id => houseIds.includes(id))))
        .sort((a, b) => b.score - a.score);
    return {
        query: cleanQuery,
        totalHouses: matches.length,
        houses: matches.slice(0, Math.max(1, limit)),
        houseIds,
        evidence: documentMatches.slice(0, Math.max(1, evidenceLimit)),
        contextualEvidence: documentMatches.filter(item => item.contextual).slice(0, Math.max(1, evidenceLimit)),
        sources,
        yearConstraint,
        corpusCount: records.length,
        hasQuery: Boolean(cleanQuery),
        truncated: matches.length > limit
    };
}

export function objectIdWhere(records, houseIds, objectIdField = "objectid") {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(objectIdField)) throw new Error("Invalid object ID field");
    const allowed = new Set(houseIds.map(String));
    const ids = [...new Set(records.filter(record => allowed.has(recordId(record)))
        .map(record => Number(record[objectIdField] ?? record.objectid))
        .filter(id => Number.isSafeInteger(id) && id > 0))];
    return ids.length ? `${objectIdField} IN (${ids.join(",")})` : "1=0";
}

export function formatResearchAnswer(result) {
    const lines = [`Found ${result.totalHouses} matching house record${result.totalHouses === 1 ? "" : "s"} in the ${result.corpusCount}-record catalog.`];
    for (const { record, evidence } of result.houses.slice(0, 12)) {
        lines.push(`\n${recordLabel(record)} (${recordId(record)}): Architect: ${textValue(record.architect) || "not documented"}; date: ${yearLabel(record)}; landscape designer: ${textValue(record.landscape_designer) || "not documented"}.`);
        if (record.research_architect) lines.push(`Research attribution: ${textValue(record.research_architect)}. The architect field above preserves the original index; conflicting attributions must be read with the catalog qualification and cited evidence.`);
        if (record.research_summary) lines.push(textValue(record.research_summary));
        for (const item of evidence.slice(0, 2)) lines.push(`Documented property finding: ${textValue(item.claim)} Source: ${citationLabel(item, result.sources)}.`);
        if (record.record_issues) lines.push(`Catalog qualification: ${textValue(record.record_issues)}`);
    }
    const contextual = result.evidence.filter(item => item.contextual);
    if (contextual.length) {
        lines.push("\nContextual and unlinked research — these passages cover general theory, neighborhood history, source notes, or properties not linked to a catalog address. They do not establish a finding about any individual house:");
        for (const item of contextual.slice(0, 4)) lines.push(`${textValue(item.claim)} Source: ${citationLabel(item, result.sources)}.`);
    }
    const otherEvidence = result.evidence.filter(item => !item.contextual && !evidenceHouseIds(item).some(id => result.houses.slice(0, 12).some(({ record }) => recordId(record) === String(id))));
    for (const item of otherEvidence.slice(0, 3)) lines.push(`\nDocumented research: ${textValue(item.claim)} Source: ${citationLabel(item, result.sources)}.`);
    if (!result.totalHouses && !result.evidence.length) lines.push("No cited match was found. Try a street number, architect, year, or a shorter research topic. Missing information means not documented in this catalog.");
    if (result.truncated || result.totalHouses > 12) lines.push("Only the first matching records are listed; use a more specific question to narrow the results.");
    lines.push("\nHouse facts come from the catalog and explicitly linked evidence. Contextual readings are kept separate. The agent does not infer an architect, date, landscape designer, or location from general theory.");
    return lines.join("\n");
}
