function pickSamples(msgs, n) {
    if (msgs.length <= n) return msgs;
    if (n === 1) return [msgs[0]];
    if (n === 2) return [msgs[0], msgs[msgs.length - 1]];
    // n >= 3: first, middle, last (then evenly distributed extras)
    const out = [msgs[0]];
    const mid = Math.floor(msgs.length / 2);
    out.push(msgs[mid]);
    out.push(msgs[msgs.length - 1]);
    return out.slice(0, n);
}

function topSources(msgs, cap = 10) {
    const counts = new Map();
    for (const m of msgs) {
        const s = m.source ?? "unknown";
        counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, cap)
        .map(([s]) => s);
}

export function formatClusterResponse({
    messages, assignments, templates, labels = {},
    minClusterSize = 2, includeSamples = 3, skippedMessages = 0,
}) {
    const total = messages.length;
    const buckets = new Map(); // templateId -> { messages: [...], indexes: [...] }
    for (const a of assignments) {
        if (!buckets.has(a.templateId)) buckets.set(a.templateId, []);
        buckets.get(a.templateId).push(messages[a.messageIndex]);
    }

    const tplById = new Map(templates.map(t => [t.id, t]));

    const fullClusters = [];
    const miscMessages = [];
    let miscPatternCount = 0;

    for (const [id, msgs] of buckets.entries()) {
        if (msgs.length < minClusterSize) {
            miscPatternCount++;
            for (const m of msgs) miscMessages.push(m);
            continue;
        }
        const tpl = tplById.get(id);
        const sortedByTime = [...msgs].sort((a, b) =>
            (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));
        fullClusters.push({
            template_id: id,
            template: tpl?.template ?? "(unknown)",
            label: labels[id] ?? null,
            label_present: !!labels[id],
            count: msgs.length,
            percentage: Math.round((msgs.length / total) * 1000) / 10,
            first_seen: sortedByTime[0]?.timestamp ?? null,
            last_seen: sortedByTime[sortedByTime.length - 1]?.timestamp ?? null,
            sources: topSources(msgs),
            sample_messages: pickSamples(sortedByTime, includeSamples).map(m => ({
                timestamp: m.timestamp,
                source: m.source,
                message: m.message,
            })),
        });
    }

    fullClusters.sort((a, b) => b.count - a.count);

    if (miscMessages.length > 0) {
        const sortedMisc = [...miscMessages].sort((a, b) =>
            (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));
        fullClusters.push({
            template_id: "_misc",
            template: `<misc — ${miscPatternCount} singleton patterns>`,
            label: null,
            label_present: false,
            count: miscMessages.length,
            percentage: Math.round((miscMessages.length / total) * 1000) / 10,
            first_seen: sortedMisc[0]?.timestamp ?? null,
            last_seen: sortedMisc[sortedMisc.length - 1]?.timestamp ?? null,
            sources: topSources(miscMessages),
            sample_messages: pickSamples(sortedMisc, includeSamples).map(m => ({
                timestamp: m.timestamp, source: m.source, message: m.message,
            })),
        });
    }

    const newCount = templates.filter(t => t.isNew).length;
    const reinforcedCount = templates.length - newCount;

    return {
        total_messages_clustered: total,
        skipped_messages: skippedMessages,
        total_clusters: fullClusters.length,
        new_templates_learned: newCount,
        reinforced_templates: reinforcedCount,
        clusters: fullClusters,
    };
}
