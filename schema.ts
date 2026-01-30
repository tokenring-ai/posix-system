import {z} from "zod";

export const LocalFileSystemProviderOptionsSchema = z.object({
  workingDirectory: z.string(),
  defaultSelectedFiles: z.array(z.string()).optional(),
});
export type LocalFileSystemProviderOptions = z.output<typeof LocalFileSystemProviderOptionsSchema>;

export const LocalTerminalProviderOptionsSchema = z.object({
  workingDirectory: z.string(),
});

export type LocalTerminalProviderOptions = z.output<typeof LocalTerminalProviderOptionsSchema>;