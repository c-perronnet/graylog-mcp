#!/usr/bin/env node
// HARD-01 — Static auditor for tool descriptions in src/tools.js.
//
// The agent's tool-selection accuracy degrades as descriptions blow past
// ~200 chars or fail to discriminate between sibling tools (Pitfall M7). This
// auditor enforces two invariants on every entry in `toolDefinitions`:
//
//   1. length   — description <= DESCRIPTION_BUDGET (200) characters
//   2. discrim. — description either spans two sentences OR contains an
//                 explicit comparative keyword ("vs.", "rather than",
//                 "instead of", "use this when", etc.)
//   3. empty    — description is non-empty
//
// Outputs:
//   - audit(toolDefinitions) → array of {name, rule, ...ctx} (pure, importable)
//   - CLI entry point exits 0 on clean, 1 on violations, 2 on load failure
//
// Test seam: SRC_TOOLS_PATH env var lets tests point the CLI at a fixture file
// in tmpdir without touching src/tools.js.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export const DESCRIPTION_BUDGET = 200;

// Comparative-phrase regex — case-insensitive. Any one of these makes a
// description "discriminating" even when written as a single sentence.
//
// Word-boundary anchors (\b) keep "vs" from matching inside "versus" or other
// alphanumeric runs. "vs." matches both with and without the trailing period
// because the \. is optional.
export const COMPARATIVE_PHRASES =
    /\b(vs\.?|rather than|instead of|use this when|use this vs|use this rather|contrast(ed)? with|unlike|as opposed to|prefer(s)? this when|distinct from)\b/i;

// Sentence-split regex — counts terminators (.!?) followed by whitespace or
// end-of-string. A description with at least 2 such terminators is treated as
// "multi-sentence" and passes the discrimination check without requiring a
// comparative keyword.
export const SENTENCE_SPLIT = /[.!?](\s+|$)/g;

/**
 * Walk a toolDefinitions array and return a flat array of violations.
 *
 * @param {Array<{name: string, description?: string}>} toolDefinitions
 * @returns {Array<{name: string, rule: "empty"|"length"|"discrimination", [key: string]: any}>}
 */
export function audit(toolDefinitions) {
    const violations = [];
    for (const tool of toolDefinitions) {
        const name = tool?.name ?? "<unnamed>";
        const description = tool?.description;
        if (description === undefined || description === null || description.length === 0) {
            violations.push({
                name,
                rule: "empty",
                description: description ?? null,
            });
            continue;
        }
        if (description.length > DESCRIPTION_BUDGET) {
            violations.push({
                name,
                rule: "length",
                length: description.length,
                budget: DESCRIPTION_BUDGET,
            });
        }
        const sentenceCount = (description.match(SENTENCE_SPLIT) ?? []).length;
        const hasComparative = COMPARATIVE_PHRASES.test(description);
        if (sentenceCount < 2 && !hasComparative) {
            violations.push({
                name,
                rule: "discrimination",
                description,
            });
        }
    }
    return violations;
}

// CLI entrypoint — runs when invoked as `node scripts/audit-tool-descriptions.js`.
// Skipped when imported by tests.
const isMain =
    process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
    const srcPath =
        process.env.SRC_TOOLS_PATH ??
        resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "tools.js");

    let mod;
    try {
        mod = await import(srcPath);
    } catch (err) {
        console.error(`[audit] failed to import ${srcPath}: ${err.message}`);
        process.exit(2);
    }
    const tools = mod.toolDefinitions ?? mod.default;
    if (!Array.isArray(tools)) {
        console.error(
            `[audit] could not find toolDefinitions array in ${srcPath}`,
        );
        process.exit(2);
    }
    const violations = audit(tools);
    if (violations.length === 0) {
        console.log(
            `[audit] OK — ${tools.length} tool descriptions pass (<=${DESCRIPTION_BUDGET} chars, discrimination sentence present)`,
        );
        process.exit(0);
    }
    console.error(`[audit] ${violations.length} violation(s):`);
    for (const v of violations) {
        if (v.rule === "length") {
            console.error(`  - ${v.name}: length ${v.length} > budget ${v.budget}`);
        } else if (v.rule === "discrimination") {
            console.error(
                `  - ${v.name}: missing discrimination sentence (single sentence, no comparative keyword)`,
            );
        } else {
            console.error(`  - ${v.name}: empty description`);
        }
    }
    process.exit(1);
}
