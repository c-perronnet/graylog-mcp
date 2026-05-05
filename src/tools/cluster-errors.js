import { getActiveConnectionConfig, getActiveConnection, getConnections } from "../config.js";
import { buildQueryString, searchGraylog, buildStreamFilter, extractMessages } from "../query.js";
import { normalizeTimeRangeArgs } from "../timerange.js";
import { get as getStrategy } from "../clustering/index.js";
import { loadTemplateStore, saveTemplateStore } from "../clustering/template-store.js";
import { normalizeMessage } from "../clustering/preprocess.js";
import { formatClusterResponse } from "../clustering/formatter.js";
import { _getSearchOverride } from "../clustering/_test_hooks.js";

const MAX_SAMPLE = 10000;

function errorResponse(text) {
    return { isError: true, content: [{ type: "text", text }] };
}

export async function handleClusterLogMessages(request) {
    const args = request.params.arguments || {};

    // Resolve connection (test override allowed)
    let connectionName = args._testConnection || getActiveConnection();
    let conn;
    if (args._testConnection) {
        conn = { baseUrl: "http://test", apiToken: "test" };
    } else {
        conn = getActiveConnectionConfig();
        if (!conn) {
            const available = Object.keys(getConnections()).join(", ");
            return errorResponse(`No active connection. Use 'use_connection' first. Available: ${available || "none"}`);
        }
    }

    const algorithm = args.algorithm || "drain3";
    let strategy;
    try { strategy = getStrategy(algorithm); }
    catch (err) { return errorResponse(err.message); }

    let sampleSize = args.sampleSize ?? 1000;
    let warning = null;
    if (sampleSize > MAX_SAMPLE) {
        warning = `sampleSize clamped from ${sampleSize} to ${MAX_SAMPLE}`;
        sampleSize = MAX_SAMPLE;
    }

    const field = args.field || "message";
    const { timeRange } = normalizeTimeRangeArgs(args);
    const queryString = buildQueryString(args.query, args.filters, args.exactMatch ?? true);
    const streamFilter = buildStreamFilter(args.streamIds);

    // Fetch messages (overridable for tests)
    let fetched;
    try {
        const override = _getSearchOverride();
        if (override) {
            fetched = await override({ queryString, timeRange, sampleSize, streamFilter });
        } else {
            const payload = {
                queries: [{
                    id: "q1",
                    query: { type: "elasticsearch", query_string: queryString },
                    filter: streamFilter,
                    timerange: timeRange,
                    search_types: [{ id: "st1", type: "messages", limit: sampleSize, offset: 0 }],
                }],
            };
            const data = await searchGraylog(conn.baseUrl, conn.apiToken, payload);
            const { totalResults, extracted } = extractMessages(data, [field, "timestamp", "source"]);
            fetched = { total_results: totalResults, messages: extracted };
        }
    } catch (err) {
        return errorResponse(`Error fetching messages: ${err.message}`);
    }

    if (!fetched.messages || fetched.messages.length === 0) {
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    total_messages_clustered: 0, skipped_messages: 0,
                    total_clusters: 0, algorithm, time_range: timeRange,
                    query: queryString, clusters: [], warning,
                }),
            }],
        };
    }

    // Prepare normalized strings for clustering, keep original messages for formatting
    const normalized = [];
    const keptMessages = [];
    let skipped = 0;
    for (const m of fetched.messages) {
        const text = m[field];
        if (typeof text !== "string" || text.length === 0) { skipped++; continue; }
        normalized.push(normalizeMessage(text));
        keptMessages.push({
            timestamp: m.timestamp, source: m.source, message: text,
        });
    }

    // Cluster
    const store = loadTemplateStore(connectionName);
    const instance = strategy.hydrate(store.algorithm_state || {});
    let clusterResult;
    try {
        clusterResult = strategy.cluster(instance, normalized, {
            similarityThreshold: args.similarityThreshold ?? 0.6,
            maxChildren: args.maxChildren ?? 100,
        });
    } catch (err) {
        return errorResponse(`Clustering failed: ${err.message}`);
    }

    // Pre-tally per-template: count + sources contributed by THIS batch.
    const perTemplate = new Map();
    for (const a of clusterResult.assignments) {
        let bucket = perTemplate.get(a.templateId);
        if (!bucket) { bucket = { count: 0, sources: new Set() }; perTemplate.set(a.templateId, bucket); }
        bucket.count++;
        const src = keptMessages[a.messageIndex]?.source;
        if (src) bucket.sources.add(src);
    }

    // Update store unless readOnly
    const labels = {};
    const nowIso = new Date().toISOString();
    if (!args.readOnly) {
        for (const t of clusterResult.templates) {
            const tally = perTemplate.get(t.id) || { count: 0, sources: new Set() };
            const existing = store.templates[t.id];
            if (existing) {
                existing.count += tally.count;
                existing.last_seen = nowIso;
                existing.template = t.template;
                existing.tokens = t.tokens;
                const merged = new Set(existing.sources_seen || []);
                for (const s of tally.sources) merged.add(s);
                existing.sources_seen = [...merged];
            } else {
                store.templates[t.id] = {
                    id: t.id,
                    template: t.template,
                    label: null,
                    tokens: t.tokens,
                    count: tally.count,
                    first_seen: nowIso,
                    last_seen: nowIso,
                    sources_seen: [...tally.sources],
                };
            }
        }
        store.algorithm_state = strategy.serialize(instance);
        try { saveTemplateStore(connectionName, store); }
        catch (err) { console.error(`[clustering] failed to persist store: ${err.message}`); }
    }
    for (const t of clusterResult.templates) {
        if (store.templates[t.id]?.label) labels[t.id] = store.templates[t.id].label;
    }

    const body = formatClusterResponse({
        messages: keptMessages,
        assignments: clusterResult.assignments,
        templates: clusterResult.templates,
        labels,
        minClusterSize: args.minClusterSize ?? 2,
        includeSamples: args.includeSamples ?? 3,
        skippedMessages: skipped,
    });

    body.algorithm = algorithm;
    body.time_range = timeRange;
    body.query = queryString;
    if (warning) body.warning = warning;

    return { content: [{ type: "text", text: JSON.stringify(body) }] };
}
