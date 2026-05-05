import { createHash } from "node:crypto";
import { tokenize, WILDCARD_TOKEN } from "../preprocess.js";

// implement the strategy contract to add a new clustering algorithm; register in src/clustering/index.js
const WILDCARD = WILDCARD_TOKEN;

function templateId(tokens) {
    return "tpl_" + createHash("sha1").update(tokens.join(" ")).digest("hex").slice(0, 12);
}

function similarity(a, b) {
    if (a.length !== b.length) return 0;
    let matched = 0;
    for (let i = 0; i < a.length; i++) {
        if (a[i] === b[i] || a[i] === WILDCARD || b[i] === WILDCARD) matched++;
    }
    return matched / a.length;
}

function relax(existing, candidate) {
    const out = new Array(existing.length);
    for (let i = 0; i < existing.length; i++) {
        out[i] = existing[i] === candidate[i] ? existing[i] : WILDCARD;
    }
    return out;
}

// State shape:
// { lengthBuckets: { [len]: { templates: [{ id, tokens }] } } }
// Templates are bucketed by token count; within a bucket we do a linear
// best-match similarity scan. The classic Drain3 prefix tree is a perf
// optimization for very large template counts; for our scale (≤10k messages,
// low-hundreds of templates per bucket) the linear scan is correct and
// simpler. `maxChildren` caps templates kept per length bucket (LRU evict
// oldest on overflow).

export const drain3Strategy = {
    name: "drain3",
    version: 1,

    hydrate(state) {
        return {
            lengthBuckets: state.lengthBuckets ? structuredClone(state.lengthBuckets) : {},
        };
    },

    serialize(instance) {
        return { lengthBuckets: instance.lengthBuckets };
    },

    cluster(instance, messages, opts) {
        const { similarityThreshold = 0.4, maxChildren = 100 } = opts || {};
        const assignments = [];
        const touched = new Map(); // id -> { id, template, tokens, isNew }

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            const tokens = tokenize(msg);
            const len = tokens.length;
            if (len === 0) continue;

            instance.lengthBuckets[len] ??= { templates: [] };
            const bucket = instance.lengthBuckets[len];

            let best = null, bestScore = 0;
            for (const tpl of bucket.templates) {
                const s = similarity(tpl.tokens, tokens);
                if (s > bestScore) { bestScore = s; best = tpl; }
            }

            let id;
            if (best && bestScore >= similarityThreshold) {
                const newTokens = relax(best.tokens, tokens);
                const changed = newTokens.some((t, idx) => t !== best.tokens[idx]);
                if (changed) {
                    best.tokens = newTokens;
                }
                // Template id is stable from creation; only the token pattern relaxes.
                // LRU: move matched template to tail
                const idx = bucket.templates.indexOf(best);
                if (idx !== -1 && idx !== bucket.templates.length - 1) {
                    bucket.templates.splice(idx, 1);
                    bucket.templates.push(best);
                }
                id = best.id;
                touched.set(id, { id, template: newTokens.join(" "), tokens: newTokens, isNew: false });
            } else {
                id = templateId(tokens);
                bucket.templates.push({ id, tokens });
                if (bucket.templates.length > maxChildren) {
                    bucket.templates.shift(); // evict oldest
                }
                touched.set(id, { id, template: tokens.join(" "), tokens, isNew: true });
            }

            assignments.push({ messageIndex: i, templateId: id });
        }

        return { assignments, templates: [...touched.values()] };
    },
};
