// Build-time facts about what the driver links, read from its source so the install instructions
// stay true when a dependency changes (phase 6 replaces the Boehm GC with a GC written in Milo;
// when `-lgc` leaves src/driver/toolchain.ts, the libgc prerequisite leaves the page).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const toolchain = fileURLToPath(new URL("../../src/driver/toolchain.ts", import.meta.url));

export interface ToolchainFacts {
  linksLibgc: boolean;
}

declare const data: ToolchainFacts;
export { data };

export default {
  watch: [toolchain],
  load(): ToolchainFacts {
    return { linksLibgc: readFileSync(toolchain, "utf8").includes('"-lgc"') };
  },
};
