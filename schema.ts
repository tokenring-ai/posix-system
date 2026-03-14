import {z} from "zod";

export const PosixFileSystemProviderOptionsSchema = z.object({
});
export type PosixFileSystemProviderOptions = z.output<typeof PosixFileSystemProviderOptionsSchema>;

export const PosixTerminalProviderOptionsSchema = z.object({
  isolation: z.enum(['auto', 'none', 'bubblewrap']).default('auto'),
});

export type PosixTerminalProviderOptions = z.output<typeof PosixTerminalProviderOptionsSchema>;
