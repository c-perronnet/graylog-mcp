// Per-domain zod schemas for the index-sets domain.
//
// Plan 02-01 ships the two read-only schemas: ListIndexSetsSchema (extends
// listBase) and GetIndexSetSchema (single-target read; takes a required
// indexSetId). Plans 02-02 (create/update), 02-03 (delete), and 02-04
// (set_default + cycle_deflector) will extend this file with their respective
// schemas + the 6 strict strategy configs from RESEARCH.md §Strategy Config
// Schemas. Plan 02-05 enriches schema-parity.

import { z } from "zod";
import { listBase } from "../_shared/schemas.js";

// INDEX-01: list_index_sets — narrows to listBase. The defaultFields override
// is applied at the defineListHandler call site (list-index-sets.js), not at
// schema validation time, so the schema stays minimal.
export const ListIndexSetsSchema = listBase;

// INDEX-02: get_index_set — single-target read; takes a required indexSetId.
// Plain async handler (NOT defineListHandler) because the response is a single
// IndexSetResponse DTO, not a projected list.
export const GetIndexSetSchema = z.object({
    connectionName: z.string().optional(),
    indexSetId: z.string().min(1, "indexSetId is required"),
});
