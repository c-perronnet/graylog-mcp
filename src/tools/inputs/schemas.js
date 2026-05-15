// Per-domain zod schemas for the input tools (FOUND-05 + per-domain co-location
// pattern from Phase 0). Plan 01-01 ships three read-only schemas; Plans 02-04
// extend with mutating schemas (CreateInputSchema, UpdateInputSchema, etc.) and
// per-input-type config schemas (GELF/Beats/Syslog/Raw, D-01).

import { z } from "zod";
import { listBase } from "../_shared/schemas.js";

// INPUT-01: list_input_types — narrows to listBase. No per-tool args.
export const ListInputTypesSchema = listBase;

// INPUT-02: list_inputs — narrows to listBase. The defaultFields override is
// applied at the defineListHandler call site (list-inputs.js), not at schema
// validation time, so the schema stays minimal.
export const ListInputsSchema = listBase;

// INPUT-03: get_input — single-target read; takes a required inputId. Note
// that this is NOT a list tool and does NOT compose through defineListHandler,
// so it does not extend listBase.
export const GetInputSchema = z.object({
    connectionName: z.string().optional(),
    inputId: z.string().min(1, "inputId is required"),
});
