// Side-effect barrel for the inputs domain. Importing this file once registers
// all input-domain handlers against src/dispatch.js. Loaded by
// src/tools/_register.js so the central registration barrel stays the single
// source of truth for tool→handler wiring.

import { register } from "../../dispatch.js";
import { handleListInputTypes } from "./list-input-types.js";
import { handleListInputs } from "./list-inputs.js";
import { handleGetInput } from "./get-input.js";
import { handleCreateInput } from "./create-input.js";
import { handleUpdateInput } from "./update-input.js";
import { handleDeleteInput } from "./delete-input.js";
import { handleStartInput } from "./start-input.js";
import { handleStopInput } from "./stop-input.js";

register("list_input_types", handleListInputTypes);
register("list_inputs", handleListInputs);
register("get_input", handleGetInput);
register("create_input", handleCreateInput);
register("update_input", handleUpdateInput);
register("delete_input", handleDeleteInput);
register("start_input", handleStartInput);
register("stop_input", handleStopInput);
