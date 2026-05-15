// Side-effect barrel for the inputs domain. Importing this file once registers
// all input-domain handlers against src/dispatch.js. Loaded by
// src/tools/_register.js so the central registration barrel stays the single
// source of truth for tool→handler wiring.

import { register } from "../../dispatch.js";
import { handleListInputTypes } from "./list-input-types.js";
import { handleListInputs } from "./list-inputs.js";
import { handleGetInput } from "./get-input.js";

register("list_input_types", handleListInputTypes);
register("list_inputs", handleListInputs);
register("get_input", handleGetInput);
