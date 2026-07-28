import type { TokenRingPlugin } from "@tokenring-ai/app";
import FileSystemService from "@tokenring-ai/filesystem/FileSystemService";
import TerminalService from "@tokenring-ai/terminal/TerminalService";
import { z } from "zod";
import PosixFileSystemProvider from "./PosixFileSystemProvider.ts";
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
    // Providers are registered in reconfigure once config is available.
  },
  reconfigure(app, config) {
    // register overwrites via set, so reconfigure is safe to call repeatedly.
    // waitForService covers late install order of FileSystemService/TerminalService.
    app.waitForService(FileSystemService, fileSystemService => {
      fileSystemService.registerFileSystemProvider("posix", new PosixFileSystemProvider(config.posix.filesystem));
    });

    app.waitForService(TerminalService, terminalService => {
      terminalService.registerTerminalProvider("posix", new PosixTerminalProvider(app, terminalService, config.posix.terminal));
    });
  },
  configSchema: packageConfigSchema,
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
