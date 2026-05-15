import { getActiveConnection, getActiveConnectionConfig, getConnections } from "../config.js";
import { loadTemplateStore, saveTemplateStore } from "../clustering/template-store.js";

function errorResponse(text) {
    return { isError: true, content: [{ type: "text", text }] };
}

function resolveConnection(args) {
    if (args._testConnection) return { name: args._testConnection };
    const conn = getActiveConnectionConfig();
    if (!conn) {
        const available = Object.keys(getConnections()).join(", ");
        return { error: errorResponse(`No active connection. Use 'set_active_connection' first. Available: ${available || "none"}`) };
    }
    return { name: getActiveConnection() };
}

export async function handleListTemplates(request) {
    const args = request.params.arguments || {};
    const r = resolveConnection(args);
    if (r.error) return r.error;
    const store = loadTemplateStore(r.name);

    const limit = args.limit ?? 50;
    const sortBy = args.sortBy ?? "count";
    const filterLabel = args.filterLabel;

    let items = Object.values(store.templates);
    if (filterLabel) items = items.filter(t => t.label === filterLabel);

    const sorters = {
        count: (a, b) => b.count - a.count,
        last_seen: (a, b) => (b.last_seen ?? "").localeCompare(a.last_seen ?? ""),
        first_seen: (a, b) => (b.first_seen ?? "").localeCompare(a.first_seen ?? ""),
    };
    items.sort(sorters[sortBy] || sorters.count);

    return {
        content: [{
            type: "text",
            text: JSON.stringify({ total: items.length, templates: items.slice(0, limit) }),
        }],
    };
}

export async function handleDeleteTemplate(request) {
    const args = request.params.arguments || {};
    if (!args.templateId) return errorResponse("templateId is required");
    const r = resolveConnection(args);
    if (r.error) return r.error;
    const store = loadTemplateStore(r.name);
    if (!store.templates[args.templateId]) {
        return errorResponse(`Template "${args.templateId}" not found`);
    }
    delete store.templates[args.templateId];
    saveTemplateStore(r.name, store);
    return {
        content: [{ type: "text", text: JSON.stringify({ message: `Template "${args.templateId}" deleted` }) }],
    };
}

export async function handleRenameTemplate(request) {
    const args = request.params.arguments || {};
    if (!args.templateId) return errorResponse("templateId is required");
    if (typeof args.label !== "string") return errorResponse("label is required (string)");
    const r = resolveConnection(args);
    if (r.error) return r.error;
    const store = loadTemplateStore(r.name);
    const t = store.templates[args.templateId];
    if (!t) return errorResponse(`Template "${args.templateId}" not found`);
    t.label = args.label;
    saveTemplateStore(r.name, store);
    return {
        content: [{ type: "text", text: JSON.stringify({ message: "label updated", template: t }) }],
    };
}

export async function handleExportTemplates(request) {
    const args = request.params.arguments || {};
    const r = resolveConnection(args);
    if (r.error) return r.error;
    const store = loadTemplateStore(r.name);
    return {
        content: [{
            type: "text",
            text: JSON.stringify({
                connection: r.name,
                algorithm: store.algorithm,
                templates: store.templates,
            }),
        }],
    };
}

export async function handleImportTemplates(request) {
    const args = request.params.arguments || {};
    if (!args.templates || typeof args.templates !== "object") {
        return errorResponse("templates (object) is required");
    }
    const mode = args.mode || "merge";
    if (mode !== "merge" && mode !== "replace") {
        return errorResponse(`mode must be "merge" or "replace", got "${mode}"`);
    }
    const r = resolveConnection(args);
    if (r.error) return r.error;
    const store = loadTemplateStore(r.name);
    if (mode === "replace") store.templates = {};
    let added = 0;
    for (const [id, tpl] of Object.entries(args.templates)) {
        store.templates[id] = { ...tpl, id };
        added++;
    }
    saveTemplateStore(r.name, store);
    return {
        content: [{
            type: "text",
            text: JSON.stringify({ message: `imported ${added} templates (mode: ${mode})`, total: Object.keys(store.templates).length }),
        }],
    };
}
