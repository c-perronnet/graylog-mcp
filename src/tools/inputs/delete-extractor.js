// INPUT-11: delete_extractor — DELETE /api/system/inputs/{inputId}/extractors/{extractorId}.
//
// D-09 single-target — NO cascade enumeration. Extractors are leaf resources
// (they have no child entities), so the delete_input cascade-preview pattern
// (Plan 02 / D-05) is not reused here. The dry-run preview MUST NOT surface
// a `cascades` block — handler.js only emits cascades when build() sets the
// key, and this handler deliberately omits it.
//
// Why deliberate omission matters: if a later refactor accidentally added
// `cascades: { something: [] }` to the descriptor, the dry-run preview would
// emit it and the agent would conclude that delete_extractor has cascades.
// The threat-model T-01-04-05 contract is structural: leaf delete = no
// cascade key in build's return object.

import { defineMutatingHandler } from "../_shared/handler.js";
import { DeleteExtractorSchema } from "./schemas.js";

export const handleDeleteExtractor = defineMutatingHandler({
    name: "delete_extractor",
    schema: DeleteExtractorSchema,
    build(args) {
        return {
            method: "DELETE",
            path: `/api/system/inputs/${args.inputId}/extractors/${args.extractorId}`,
            body: undefined,
            postApplyEstimate: { id: args.extractorId },
            // D-09: NO cascade key. delete_extractor is single-target;
            // extractors carry no child resources.
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        `Delete extractor ${args.extractorId} from input ${args.inputId}`,
});
