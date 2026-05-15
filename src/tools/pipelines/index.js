// Side-effect register barrel for the pipelines domain (Phase 4).
// Imported once by src/tools/_register.js so the central registration
// barrel stays the single source of truth for tool→handler wiring.
//
// Plan 04-02 — pipeline CRUD (PIPE-01..PIPE-05): 5 tools registered here.
// Plan 04-03 — pipeline-rule CRUD (PIPE-06..PIPE-09): 4 tools added.
// Plans 04-04 / 04-05 will extend with the 5 remaining net-new tools
// (delete_pipeline_rule + list_pipeline_functions + simulate_pipeline_rule
// + connect/disconnect_pipelines_*_stream).

import { register } from "../../dispatch.js";

import { handleListPipelines } from "./list-pipelines.js";
import { handleGetPipeline } from "./get-pipeline.js";
import { handleCreatePipeline } from "./create-pipeline.js";
import { handleUpdatePipeline } from "./update-pipeline.js";
import { handleDeletePipeline } from "./delete-pipeline.js";
import { handleListPipelineRules } from "./list-pipeline-rules.js";
import { handleGetPipelineRule } from "./get-pipeline-rule.js";
import { handleCreatePipelineRule } from "./create-pipeline-rule.js";
import { handleUpdatePipelineRule } from "./update-pipeline-rule.js";

register("list_pipelines", handleListPipelines);
register("get_pipeline", handleGetPipeline);
register("create_pipeline", handleCreatePipeline);
register("update_pipeline", handleUpdatePipeline);
register("delete_pipeline", handleDeletePipeline);
register("list_pipeline_rules", handleListPipelineRules);
register("get_pipeline_rule", handleGetPipelineRule);
register("create_pipeline_rule", handleCreatePipelineRule);
register("update_pipeline_rule", handleUpdatePipelineRule);
