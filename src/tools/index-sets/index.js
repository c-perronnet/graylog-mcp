// Side-effect barrel for the index-sets domain. Importing this file once
// registers all index-sets-domain handlers against src/dispatch.js. Loaded
// by src/tools/_register.js so the central registration barrel stays the
// single source of truth for tool→handler wiring.
//
// Plan 02-01 registers the two read tools and the cross-domain
// await_system_job primitive (which lives under _shared/ so Phase 3+ async
// tools can reuse it). Plans 02-02 / 02-03 / 02-04 will extend this list
// with create / update / delete / set_default / cycle_deflector.

import { register } from "../../dispatch.js";
import { handleListIndexSets } from "./list-index-sets.js";
import { handleGetIndexSet } from "./get-index-set.js";
import { handleCreateIndexSet } from "./create-index-set.js";
import { handleUpdateIndexSet } from "./update-index-set.js";
import { handleDeleteIndexSet } from "./delete-index-set.js";
import { handleSetDefaultIndexSet } from "./set-default-index-set.js";
import { handleAwaitSystemJob } from "../_shared/system-job.js";

register("list_index_sets", handleListIndexSets);
register("get_index_set", handleGetIndexSet);
register("create_index_set", handleCreateIndexSet);
register("update_index_set", handleUpdateIndexSet);
register("delete_index_set", handleDeleteIndexSet);
register("set_default_index_set", handleSetDefaultIndexSet);
register("await_system_job", handleAwaitSystemJob);
