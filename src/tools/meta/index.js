// Side-effect barrel for the meta domain. Importing this file once registers
// the list_admin_tools meta-tool against src/dispatch.js. Loaded by
// src/tools/_register.js so the central registration barrel stays the single
// source of truth for tool→handler wiring.
//
// The meta domain is pure-static — no Graylog connection required. Adding new
// meta tools here MUST preserve that property (the agent uses list_admin_tools
// to orient before set_active_connection runs).

import { register } from "../../dispatch.js";
import { listAdminToolsHandler } from "./list-admin-tools.js";

register("list_admin_tools", listAdminToolsHandler);
