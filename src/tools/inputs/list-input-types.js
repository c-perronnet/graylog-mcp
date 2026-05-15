// INPUT-01: list_input_types — surfaces the per-connection input-type catalogue.
//
// Composes through defineListHandler so the M6 default-narrow / limit-clamping
// guardrails apply uniformly. The fetch callback consults the D-06 cache so
// repeated invocations within a server process do NOT re-hit Graylog.
//
// defineListHandler resolves the connection up-front and threads connectionName
// + conn through the fetch args as `_connectionName` / `_conn` — that's the
// seam we use here to feed the cache without a duplicate resolveConnection
// call inside fetch.

import { defineListHandler } from "../_shared/list.js";
import { ListInputTypesSchema } from "./schemas.js";
import { getCachedTypeCatalogue } from "./type-catalogue.js";

export const handleListInputTypes = defineListHandler({
    name: "list_input_types",
    schema: ListInputTypesSchema,
    fetch: async (_client, args) => {
        const catalogue = await getCachedTypeCatalogue(
            args._connectionName,
            args._conn,
        );
        // Flatten Map<FQCN, InputTypeInfo> into a list-shaped projection so
        // the framework's projection/limit machinery can do its job. Each
        // item carries:
        //   id (FQCN) — primary key; survives the default [id,title,description] projection
        //   title (display name) — agent-friendly label
        //   description — short description; honors the default projection
        //   type — same FQCN, surfaced explicitly so agents that pass
        //          fields:["type"] also see it
        //   is_exclusive — singleton-per-cluster flag
        //   requested_configuration — full config map (only visible when
        //                              fields:'all' or fields:['requested_configuration'])
        return Object.entries(catalogue).map(([fqcn, info]) => ({
            id: fqcn,
            title: info?.name ?? fqcn,
            description: info?.description ?? "",
            type: fqcn,
            is_exclusive: info?.is_exclusive ?? false,
            requested_configuration: info?.requested_configuration ?? {},
        }));
    },
});
