import type { TokenRingPlugin } from "@tokenring-ai/app";
import TerminalService from "@tokenring-ai/terminal/TerminalService";
import { z } from "zod";
import PosixTerminalProvider from "./PosixTerminalProvider.ts";
import packageJSON from "./package.json" with { type: "json" };
import { PosixConfigSchema } from "./schema.ts";

const packageConfigSchema = z.object({
  posix: PosixConfigSchema.prefault({}),
});

export default {
  name: packageJSON.name,
  displayName: "POSIX System",
  version: packageJSON.version,
  description: packageJSON.description,
  install(_app) {
    // The provider is registered in reconfigure once config is available.
  },
  reconfigure(app, config) {
    // register overwrites via set, so reconfigure is safe to call repeatedly.
    // waitForService covers late install order of TerminalService.
    app.waitForService(TerminalService, terminalService => {
      terminalService.registerTerminalProvider("posix", new PosixTerminalProvider(app, terminalService, config.posix.terminal));
    });
  },
  configSchema: packageConfigSchema,
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
