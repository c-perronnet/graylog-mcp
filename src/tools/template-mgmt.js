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
        return { error: errorResponse(`No active connection. Use 'use_connection' first. Available: ${available || "none"}`) };
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
