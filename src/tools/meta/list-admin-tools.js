// list_admin_tools (HARD-02) — pure-static meta-tool. Returns a brief
// inventory of every registered tool grouped by domain. No Graylog
// connection required (the tool works before set_active_connection).
//
// Pitfall M7 mitigation: with 91 tools the agent's tool-selection accuracy
// degrades when all descriptions live in every system prompt. This tool
// lets the agent orient at the start of a session with a single call —
// the inventory is descriptions ≤120 chars per tool vs the full ≤200 chars,
// so the round-trip cost is far below dumping the full /tools list.

import { toolDefinitions } from "../../tools.js";

// Domain inference: walk the tool name with the project's
// `<verb>_<domain>_<noun>` convention (FOUND-13). Hand-curated overrides for
// v2.3 names that predate the convention AND for full-name overrides where
// segment inference would mis-classify (e.g. create_app_health_dashboard
// belongs to "blueprints" even though its name ends in "dashboard").
const DOMAIN_OVERRIDES = {
    // ----- meta -----
    list_connections: "meta",
    set_active_connection: "meta",
    list_admin_tools: "meta",
    await_system_job: "meta",

    // ----- v2.3 read/search tools -----
    search_messages_graylog: "search",
    get_context_messages: "search",
    get_histogram_messages: "search",
    get_aggregation_field: "search",
    get_aggregation_field_over_time: "search",
    debug_query_histogram: "search",
    list_field_values: "search",
    create_saved_search: "search",
    list_saved_searches: "search",
    get_saved_search: "search",
    delete_saved_search: "search",
    cluster_log_messages: "search",
    list_log_templates: "search",
    delete_log_template: "search",
    update_log_template: "search",
    export_log_templates: "search",
    import_log_templates: "search",
    search_events_graylog: "events",

    // ----- blueprints (full-name overrides — segment inference would
    //       route create_app_health_dashboard → "dashboards") -----
    create_app_health_dashboard: "blueprints",
    setup_app_monitoring_stack: "blueprints",
    setup_error_alerting: "blueprints",
    setup_pipeline_for_stream: "blueprints",
    setup_long_term_archival_index: "blueprints",
    setup_debug_log_dropping: "blueprints",

    // ----- index_sets (cycle_deflector has no domain-named segment) -----
    cycle_deflector: "index_sets",

    // ----- pipelines (connect/disconnect are pipeline-stream wiring tools;
    //       primary domain is "pipelines" — segment inference would otherwise
    //       route them to "streams" because "stream" is in the name) -----
    connect_pipelines_to_stream: "pipelines",
    disconnect_pipelines_from_stream: "pipelines",

    // ----- authz (Phase 9 entity-shares read path + Phase 10 share_entity
    //       write path; the names have no domain-named segment so segment
    //       inference cannot classify them) -----
    get_entity_shares: "authz",
    list_grantees: "authz",
    share_entity: "authz",
};

// Per-segment routing for tools that follow the `<verb>_<domain>_<noun>`
// convention. First matching segment wins. Override map (above) is checked
// first; this is the fallback for everything that fits the convention.
//
// Both singular AND plural forms are listed because Phase 0's `<verb>_<domain>_<noun>`
// convention permits either (`list_streams` vs `list_stream_rules`).
const DOMAIN_FROM_SEGMENT = {
    input: "inputs",
    inputs: "inputs",
    extractor: "inputs",
    extractors: "inputs",
    index: "index_sets",   // list_index_sets, set_default_index_set, etc.
    stream: "streams",     // list_stream_rules, create_stream_rule, etc.
    streams: "streams",    // list_streams
    pipeline: "pipelines",
    pipelines: "pipelines",
    event: "events",
    notification: "events",
    notifications: "events",
    dashboard: "dashboards",
    dashboards: "dashboards",
    widget: "dashboards",
    widgets: "dashboards",
};

function inferDomain(name) {
    if (DOMAIN_OVERRIDES[name]) return DOMAIN_OVERRIDES[name];
    // Walk the segments; first match wins.
    const segments = name.split("_");
    for (const seg of segments) {
        if (DOMAIN_FROM_SEGMENT[seg]) return DOMAIN_FROM_SEGMENT[seg];
    }
    return "uncategorized";
}

function summarize(description) {
    if (!description) return "";
    // First sentence OR first 120 chars, whichever is shorter.
    const firstSentence = description.match(/^[^.!?]+[.!?]/);
    const summary = (firstSentence ? firstSentence[0] : description).trim();
    return summary.length > 120 ? summary.slice(0, 117) + "..." : summary;
}

export async function listAdminToolsHandler(request) {
    const args = request?.params?.arguments ?? {};
    const requestedDomain = args.domain ?? null;

    const inventory = toolDefinitions.map((t) => ({
        name: t.name,
        domain: inferDomain(t.name),
        summary: summarize(t.description),
    }));

    const allDomains = [...new Set(inventory.map((i) => i.domain))].sort();
    const domainGroups = {};
    for (const dom of allDomains) {
        domainGroups[dom] = inventory
            .filter((i) => i.domain === dom)
            .map(({ name, summary }) => ({ name, summary }));
    }

    if (requestedDomain && !allDomains.includes(requestedDomain)) {
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    tool: "list_admin_tools",
                    domain: requestedDomain,
                    warning: "domain_not_found",
                    available_domains: allDomains,
                    items: [],
                    count: 0,
                }),
            }],
        };
    }

    if (requestedDomain) {
        const items = domainGroups[requestedDomain];
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    tool: "list_admin_tools",
                    domain: requestedDomain,
                    items,
                    count: items.length,
                }),
            }],
        };
    }

    return {
        content: [{
            type: "text",
            text: JSON.stringify({
                tool: "list_admin_tools",
                domains: domainGroups,
                items: inventory.map(({ name, domain, summary }) => ({ name, domain, summary })),
                count: inventory.length,
                domain_keys: allDomains,
            }),
        }],
    };
}
