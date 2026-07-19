import type { ConfigFieldMeta } from "@tokenring-ai/app/config/metadata";
import { z } from "zod";

export const PosixFileSystemProviderOptionsSchema = z.object({});
export type PosixFileSystemProviderOptions = z.output<typeof PosixFileSystemProviderOptionsSchema>;

export const PosixTerminalProviderOptionsSchema = z.object({
  sandboxProvider: z
    .enum(["auto", "bubblewrap", "sandbox-exec"])
    .default("auto")
    .meta({ description: "Sandboxing mechanism used to isolate shell commands" } satisfies ConfigFieldMeta),
});
export type PosixTerminalProviderOptions = z.output<typeof PosixTerminalProviderOptionsSchema>;

export const PosixConfigSchema = z
  .object({
    filesystem: PosixFileSystemProviderOptionsSchema.prefault({}),
    terminal: PosixTerminalProviderOptionsSchema.prefault({}).meta({ label: "Terminal" } satisfies ConfigFieldMeta),
  })
  .meta({ label: "POSIX System", description: "Local POSIX filesystem and terminal provider settings" } satisfies ConfigFieldMeta);
export type PosixConfig = z.output<typeof PosixConfigSchema>;
