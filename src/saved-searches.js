import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { getConfigPath } from "./config.js";

function getSavedSearchesPath() {
    return join(dirname(getConfigPath()), "saved-searches.json");
}

export function loadSavedSearches() {
    try {
        const data = JSON.parse(readFileSync(getSavedSearchesPath(), "utf-8"));
        return data.searches || {};
    } catch {
        return {};
    }
}

function writeSavedSearches(searches) {
    const filePath = getSavedSearchesPath();
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify({ searches }, null, 2), "utf-8");
}

export function saveSearch(name, params) {
    const searches = loadSavedSearches();
    const now = new Date().toISOString();
    const existing = searches[name];
    searches[name] = {
        name,
        query: params.query || undefined,
        filters: params.filters || undefined,
        timeRange: params.timeRange || undefined,
        from: params.from || undefined,
        to: params.to || undefined,
        fields: params.fields || undefined,
        streamIds: params.streamIds || undefined,
        exactMatch: params.exactMatch,
        pageSize: params.pageSize || undefined,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
    };
    writeSavedSearches(searches);
    return searches[name];
}

export function getSavedSearch(name) {
    const searches = loadSavedSearches();
    return searches[name] || null;
}

export function listSavedSearches() {
    const searches = loadSavedSearches();
    return Object.values(searches);
}

export function deleteSavedSearch(name) {
    const searches = loadSavedSearches();
    if (!searches[name]) return false;
    delete searches[name];
    writeSavedSearches(searches);
    return true;
}
