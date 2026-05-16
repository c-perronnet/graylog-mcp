// DASH-03 — create_dashboard. THE C7 ACCEPTANCE GATE.
//
// =====================================================================
// C7 mitigation centerpiece — internal Search+View 2-step chain
// =====================================================================
//
// Graylog model: every Dashboard is a View bound to exactly one Search
// entity via search_id. Creating a Dashboard requires TWO HTTP calls:
//   step 1: POST /api/views/search  (BARE SearchDTO body — Pitfall 3
//           exception — returns {id} for the Search entity)
//   step 2: POST /api/views         (CreateEntityRequest envelope:
//           {entity:viewDTO, share_request:null}; viewDTO.search_id MUST
//           reference step 1's response.id)
//
// C7 threat: if the agent supplied `searchId` directly, an adversarial
// agent could rebind a malicious Search to any new Dashboard. The C7
// mitigation REMOVES the agent's ability to compose this binding:
//   - D-02 STRUCTURAL: CreateDashboardSchema.strict() rejects any
//     agent-supplied `searchId` at zod parse (BEFORE build() even runs).
//   - D-01 INTERNAL CHAIN: build() composes BOTH SearchDTO + ViewDTO and
//     emits a chain transcript with dependsOn:{from:"step1.response.id",
//     as:"searchId"}. The agent's dry-run preview surfaces the full plan
//     but the agent NEVER sees the intermediate Search ID — apply-time,
//     executeChain (blueprint-chain.js) walks the chain and substitutes
//     the real ID into step 2's body.searchId via __SERVER_ASSIGNED__step1
//     placeholder replacement.
//   - D-03 INTEGRITY GATE: validateWidgetPositionIntegrity runs BEFORE
//     step 1 emission. Bidirectional strict-equality check (widget IDs ===
//     position keys); orphan widgets or orphan positions refuse with
//     `widget_position_integrity_violation` and NO HTTP fires.
//
// =====================================================================
// Wrapper-generated widget IDs (UUID-per-instance)
// =====================================================================
//
// The wrapper supplies widget.id + searchType.id via randomUUID() when the
// agent omits them. C7 mitigation REQUIRES wrapper-controlled IDs so the
// chain's wiring (widget → searchType in widget_mapping; widget → position
// in widget_positions) is internally consistent. Tests inject a seeded
// UUID generator via _setUUIDGeneratorForTests() so snapshot fixtures stay
// byte-stable across runs.
//
// =====================================================================
// FOUND-11 existingMatches probe (title-collision pre-check)
// =====================================================================
//
// build() fires a GET /api/views?query=title:<encoded> + filter on
// view.type === "DASHBOARD" via findExistingMatches. Hits surface in the
// dry-run preview's existingMatches[] array so the agent sees title
// collisions before applying. Plan 06-01's conflict.js views envelope
// amendment is the prerequisite (already shipped — see 06-01 SUMMARY).
//
// =====================================================================
// Single shared queryId (Phase 6 scope)
// =====================================================================
//
// Phase 6 dashboards are single-query (one shared Search, one shared
// "q-1" state). Multi-query dashboards (tabs) are future scope. The
// wrapper hardcodes QUERY_ID = "q-1" so SearchDTO.queries[0].id matches
// the ViewStateDTO key in viewDTO.state[QUERY_ID].

import { randomUUID } from "node:crypto";
import { defineMutatingHandler } from "../_shared/handler.js";
import { CreateDashboardSchema } from "./schemas.js";
import { buildSearchDTO, buildViewDTO } from "../../services/dashboards.js";
import { validateWidgetPositionIntegrity } from "../_shared/widget-position-integrity.js";
import { executeChain } from "../_shared/blueprint-chain.js";
import { findExistingMatches } from "../_shared/conflict.js";
import { makeClient } from "../../graylog/client.js";
import { toIdBody } from "../../graylog/normalize.js";
import { SERVER_ASSIGNED_SENTINEL } from "../_shared/dry-run.js";

const QUERY_ID = "q-1";  // wrapper-deterministic single-query scope (Phase 6)

// Test seam — lets tests inject a deterministic UUID generator so
// snapshot fixtures stay byte-stable. Production code path uses
// node:crypto's randomUUID() directly.
//
// Same convention as src/graylog/client.js _setCaptureRequest — leading
// underscore marks it test-only; NEVER call from production code.
let _uuidGenerator = randomUUID;

export function _setUUIDGeneratorForTests(fn) {
    _uuidGenerator = fn ?? randomUUID;
}

export function _clearUUIDGeneratorForTests() {
    _uuidGenerator = randomUUID;
}

// Test seam — lets tests inject a stub validator that throws, so the
// "D-03 refusal happens BEFORE HTTP" contract can be pinned independently
// of the structural guarantee (which makes a real mismatch impossible
// via the agent-facing surface). Without this seam there's no way to
// test the refusal path because the wrapper makes the input internally
// consistent by construction.
//
// Production code uses validateWidgetPositionIntegrity verbatim — the
// seam is INACTIVE unless a test explicitly sets it. Threat-model
// T-06-02-03 contract is preserved: agent CANNOT poke this seam (no
// agent input flows here; it's a function reference local to the module).
let _validateWidgetPositionIntegrity = validateWidgetPositionIntegrity;

export function _setWidgetPositionValidatorForTests(fn) {
    _validateWidgetPositionIntegrity = fn ?? validateWidgetPositionIntegrity;
}

export function _clearWidgetPositionValidatorForTests() {
    _validateWidgetPositionIntegrity = validateWidgetPositionIntegrity;
}

export const handleCreateDashboard = defineMutatingHandler({
    name: "create_dashboard",
    schema: CreateDashboardSchema,
    async build(args) {
        // 1. Wrapper supplies widget IDs + searchType IDs if absent. C7
        //    mitigation: wrapper-controlled IDs are load-bearing so the
        //    chain's wiring stays internally consistent across step 1
        //    (Search) and step 2 (View).
        const widgetsWithIds = args.widgets.map((triplet) => ({
            widget: { ...triplet.widget, id: triplet.widget.id ?? _uuidGenerator() },
            position: triplet.position,
            searchType: triplet.searchType
                ? { ...triplet.searchType, id: triplet.searchType.id ?? _uuidGenerator() }
                : null,
        }));

        // 2. D-03 widget-position integrity check BEFORE any wire emission.
        //    Bidirectional strict-equality: widget IDs === position keys.
        //    Tightens Graylog's server-side superset-only check (Pitfall 4).
        //    Throws with reason:"widget_position_integrity_violation" +
        //    isClientSide:true; handler.js's wrapGraylogError surfaces it
        //    as an isError envelope WITHOUT firing the chain.
        const widgetPositions = Object.fromEntries(
            widgetsWithIds.map((t) => [t.widget.id, t.position]),
        );
        _validateWidgetPositionIntegrity(
            widgetsWithIds.map((t) => t.widget),
            widgetPositions,
        );

        // 3. FOUND-11 existingMatches probe — surfaces dashboards with the
        //    same title (filtered to DASHBOARD-typed views Q1-style; saved
        //    searches with the same title don't count as collisions).
        const client = makeClient(args._conn);
        const existingMatches = await findExistingMatches(client, {
            listPath: `/api/views?query=${encodeURIComponent(`title:${args.title}`)}&page=1&per_page=10`,
            matchFn: (item) => item?.type === "DASHBOARD" && item?.title === args.title,
            similarityReason: "exact",
        });

        // 4. Build SearchDTO (step 1 body) + ViewDTO (step 2 body).
        //    SearchID placeholder uses SERVER_ASSIGNED_SENTINEL + "step1"
        //    marker so executeChain's substitutePlaceholders swap replaces
        //    it apply-time with step 1's response.id (the real Search ID).
        const searchDTO = buildSearchDTO({
            queryId: QUERY_ID,
            widgets: widgetsWithIds,
            timerange: args.timerange,
            query: args.query,
            streamIds: args.streamIds,
        });
        const viewDTO = buildViewDTO({
            title: args.title,
            description: args.description,
            summary: args.summary,
            searchId: `${SERVER_ASSIGNED_SENTINEL}step1`,
            queryId: QUERY_ID,
            widgets: widgetsWithIds,
        });

        // 5. Chain transcript — both planned requests surface in the
        //    dry-run preview JSON. dependsOn on step 2 declares the
        //    apply-time placeholder substitution path.
        const chain = [
            {
                step: 1,
                tool: "create_search",
                request: {
                    method: "POST",
                    path: "/api/views/search",
                    body: searchDTO,
                },
                postApplyEstimate: { id: SERVER_ASSIGNED_SENTINEL },
            },
            {
                step: 2,
                tool: "create_view",
                request: {
                    method: "POST",
                    path: "/api/views",
                    body: { entity: viewDTO, share_request: null },
                },
                dependsOn: { from: "step1.response.id", as: "searchId" },
                postApplyEstimate: { id: SERVER_ASSIGNED_SENTINEL },
            },
        ];

        // 6. Primary preview mirrors step 2 (the agent's mental model is
        //    "creating a dashboard"). handler.js spreads req.chain onto the
        //    dry-run JSON via the Plan 06-02 amendment.
        return {
            chain,
            method: "POST",
            path: "/api/views",
            body: { entity: viewDTO, share_request: null },
            postApplyEstimate: { id: SERVER_ASSIGNED_SENTINEL },
            existingMatches,
            normalize: (raw) => toIdBody(raw, { idFields: ["id"] }),
        };
    },
    async apply(client, req) {
        const result = await executeChain(client, req.chain);
        if (result.isError) return result;
        // Final response is step 2's response = the ViewDTO with id.
        return result.transcript[result.transcript.length - 1].response;
    },
    summarize: (args) =>
        `Create dashboard "${args.title}" with ${args.widgets.length} widget(s) via internal Search+View 2-step chain`,
});
