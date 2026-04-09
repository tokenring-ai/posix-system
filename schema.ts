import {z} from "zod";

export const PosixFileSystemProviderOptionsSchema = z.object({
});
export type PosixFileSystemProviderOptions = z.output<typeof PosixFileSystemProviderOptionsSchema>;

export const PosixTerminalProviderOptionsSchema = z.object({
  sandboxProvider: z.enum(['auto', 'bubblewrap']).default('auto'),
});
export type PosixTerminalProviderOptions = z.output<typeof PosixTerminalProviderOptionsSchema>;

export const PosixConfigSchema = z.object({
  filesystem: PosixFileSystemProviderOptionsSchema.prefault({}),
  terminal: PosixTerminalProviderOptionsSchema.prefault({}),
});
export type PosixConfig = z.output<typeof PosixConfigSchema>;
