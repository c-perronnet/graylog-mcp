// Side-effect register barrel for the pipelines domain (Phase 4).
// Imported once by src/tools/_register.js so the central registration
// barrel stays the single source of truth for tool→handler wiring.
//
// Plan 04-02 — pipeline CRUD (PIPE-01..PIPE-05): 5 tools registered here.
// Plans 04-03 / 04-04 / 04-05 will extend this barrel with the 9 remaining
// net-new tools (pipeline-rule CRUD + simulate, connect/disconnect, plus
// list_pipeline_functions).

import { register } from "../../dispatch.js";

import { handleListPipelines } from "./list-pipelines.js";
import { handleGetPipeline } from "./get-pipeline.js";
import { handleCreatePipeline } from "./create-pipeline.js";
import { handleUpdatePipeline } from "./update-pipeline.js";
import { handleDeletePipeline } from "./delete-pipeline.js";

register("list_pipelines", handleListPipelines);
register("get_pipeline", handleGetPipeline);
register("create_pipeline", handleCreatePipeline);
register("update_pipeline", handleUpdatePipeline);
register("delete_pipeline", handleDeletePipeline);
