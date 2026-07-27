import type { ConfigFieldMeta } from "@tokenring-ai/app/config/metadata";
import { z } from "zod";

export const PosixFileSystemProviderOptionsSchema = z.object({});
export type PosixFileSystemProviderOptions = z.output<typeof PosixFileSystemProviderOptionsSchema>;

export const PosixTerminalProviderOptionsSchema = z.object({
  sandboxProvider: z
    .enum(["auto", "bubblewrap", "sandbox-exec"])
    .default("auto")
    .meta({ description: "Sandboxing mechanism used to isolate shell commands" } satisfies ConfigFieldMeta),
  interactiveMode: z
    .enum(["pty", "pipe"])
    .default("pty")
    .meta({
      description:
        "How interactive sessions attach to the shell. 'pty' gives the shell a real terminal (color, echo, working prompts); 'pipe' uses plain stdio, producing cleaner text with no escape sequences",
    } satisfies ConfigFieldMeta),
  terminalType: z
    .string()
    .default("xterm-256color")
    .meta({ description: "TERM value advertised to the shell in pty mode" } satisfies ConfigFieldMeta),
  cols: z
    .number()
    .int()
    .min(1)
    .default(120)
    .meta({ description: "Default pty width in columns" } satisfies ConfigFieldMeta),
  rows: z
    .number()
    .int()
    .min(1)
    .default(30)
    .meta({ description: "Default pty height in rows" } satisfies ConfigFieldMeta),
});
export type PosixTerminalProviderOptions = z.output<typeof PosixTerminalProviderOptionsSchema>;

export const PosixConfigSchema = z
  .object({
    filesystem: PosixFileSystemProviderOptionsSchema.prefault({}),
    terminal: PosixTerminalProviderOptionsSchema.prefault({}).meta({ label: "Terminal" } satisfies ConfigFieldMeta),
  })
  .meta({ label: "POSIX System", description: "Local POSIX filesystem and terminal provider settings" } satisfies ConfigFieldMeta);
export type PosixConfig = z.output<typeof PosixConfigSchema>;
