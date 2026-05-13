import { snapshot } from "node:test";
import { dirname, join, basename } from "node:path";
import { mkdirSync } from "node:fs";

snapshot.setResolveSnapshotPath((testFilePath) => {
    const snapDir = join(dirname(testFilePath), "__snapshots__");
    mkdirSync(snapDir, { recursive: true });
    return join(snapDir, basename(testFilePath) + ".snapshot");
});
