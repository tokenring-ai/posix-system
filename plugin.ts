import {TokenRingPlugin} from "@tokenring-ai/app";
import FileSystemService from "@tokenring-ai/filesystem/FileSystemService";
import {FileSystemConfigSchema} from "@tokenring-ai/filesystem/schema";
import {TerminalConfigSchema} from "@tokenring-ai/terminal/schema";
import TerminalService from "@tokenring-ai/terminal/TerminalService";
import {z} from "zod";
import PosixFileSystemProvider from "./PosixFileSystemProvider.ts";
import PosixTerminalProvider from "./PosixTerminalProvider.ts";
import packageJSON from './package.json' with {type: 'json'};
import {PosixFileSystemProviderOptionsSchema, PosixTerminalProviderOptionsSchema} from "./schema.ts";

const packageConfigSchema = z.object({
  filesystem: FileSystemConfigSchema.optional(),
  terminal: TerminalConfigSchema.optional(),
});

export default {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(app, config) {
    if (config.filesystem) {
    app.waitForService(FileSystemService, fileSystemService => {
      for (const name in config.filesystem!.providers) {
        const provider = config.filesystem!.providers[name];
        if (provider.type === "posix") {
          fileSystemService.registerFileSystemProvider(name, new PosixFileSystemProvider(PosixFileSystemProviderOptionsSchema.parse(provider)));
        }
      }
    });
    }
    if (config.terminal) {
      app.waitForService(TerminalService, terminalService => {
        for (const name in config.terminal!.providers) {
          const provider = config.terminal!.providers[name];
          if (provider.type === "posix") {
            terminalService.registerTerminalProvider(name, new PosixTerminalProvider(app, terminalService, PosixTerminalProviderOptionsSchema.parse(provider)));
          }
        }
      });
    }
  },
  config: packageConfigSchema
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
