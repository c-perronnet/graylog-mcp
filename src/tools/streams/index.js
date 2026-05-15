// Side-effect register barrel for the streams domain. Imported once by
// src/tools/_register.js so the central registration barrel stays the single
// source of truth for tool->handler wiring.
//
// Plan 03-01 registers the three read tools (STREAM-01 list_streams,
// STREAM-02 get_stream, STREAM-07 list_stream_rules). Plans 03-02 / 03-03
// / 03-04 will extend with the 9 remaining mutating tools (create_stream,
// update_stream, delete_stream, start_stream, pause_stream,
// create_stream_rule, update_stream_rule, delete_stream_rule,
// test_stream_match).
//
// Pitfall S5: the v2.3 `list_streams` registration line is removed from
// src/tools/_register.js in the same plan; this barrel claims the name.

import { register } from "../../dispatch.js";
import { handleListStreams } from "./list-streams.js";
import { handleGetStream } from "./get-stream.js";
import { handleListStreamRules } from "./list-stream-rules.js";
// Plan 03-02 mutating tools — STREAM-03, STREAM-04, STREAM-06.
import { handleCreateStream } from "./create-stream.js";
import { handleUpdateStream } from "./update-stream.js";
import { handleStartStream } from "./start-stream.js";
import { handlePauseStream } from "./pause-stream.js";
// Plan 03-03 — STREAM-05 (C2 mitigation centerpiece).
import { handleDeleteStream } from "./delete-stream.js";

register("list_streams", handleListStreams);
register("get_stream", handleGetStream);
register("list_stream_rules", handleListStreamRules);
register("create_stream", handleCreateStream);
register("update_stream", handleUpdateStream);
register("start_stream", handleStartStream);
register("pause_stream", handlePauseStream);
register("delete_stream", handleDeleteStream);
