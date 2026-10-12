# @tokenring-ai/posix-system

Concrete POSIX filesystem and terminal providers for TokenRing applications, enabling agents to interact with the local
system in a controlled manner.

## Overview

The `posix-system` package provides two core providers that implement TokenRing's filesystem and terminal abstractions
for Unix-like environments:

- **PosixFileSystemProvider** — Local filesystem operations using `fs-extra`, Bun's `Glob`, and Node's recursive
  `fs.watch`.
- **PosixTerminalProvider** — Shell command execution via `Bun.spawn` with optional sandboxing (bubblewrap on Linux,
  `sandbox-exec` on macOS) and persistent interactive PTY sessions.

Both providers integrate with TokenRing's service architecture. The plugin registers a single `"posix"` provider instance
with `FileSystemService` and `TerminalService` during the `reconfigure` lifecycle hook.

### Key Features

- **Filesystem operations**: Read, write, append, delete, rename, copy, stat, glob, grep, and watch
- **Ignore-aware operations**: Listing and searching methods accept ignore filters for respecting VCS/IDE patterns
- **File watching**: Node's recursive `fs.watch` backend with stability thresholds and debounced event emission
- **Shell execution**: `Bun.spawn` with timeout, combined stdout/stderr, detached process groups, and output capping
- **Bubblewrap sandboxing**: Optional Linux sandbox with read-only system directories and restricted write access
- **sandbox-exec sandboxing**: Optional macOS sandbox with deny-by-default file writes and no network access
- **Interactive sessions**: Persistent PTY or pipe-mode sessions via Bun's native terminal API
- **Async generators**: Directory tree traversal via async generators for memory-efficient iteration

## Installation

```bash
bun add @tokenring-ai/posix-system
```

## Chat Commands

This package does not define any chat commands. It provides providers that are consumed by the `FileSystemService` and
`TerminalService`.

## Tools

This package does not define any tools. It provides providers that are consumed by the `FileSystemService` and
`TerminalService`.

## Configuration

The plugin reads its configuration from the `posix` key in the application config. All fields have defaults, so the
plugin works with an empty configuration.

```yaml
posix:
  filesystem: {}
  terminal:
    sandboxProvider: auto
    interactiveMode: pty
    terminalType: xterm-256color
    cols: 120
    rows: 30
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `filesystem` | `object` | No | `{}` | Filesystem provider options (currently no fields) |
| `terminal` | `TerminalConfig` | No | (see defaults below) | Terminal provider options |
| `terminal.sandboxProvider` | `"auto" \| "bubblewrap" \| "sandbox-exec"` | No | `"auto"` | Sandboxing mechanism used to isolate shell commands |
| `terminal.interactiveMode` | `"pty" \| "pipe"` | No | `"pty"` | How interactive sessions attach to the shell. `"pty"` gives the shell a real terminal (color, echo, working prompts); `"pipe"` uses plain stdio, producing cleaner text with no escape sequences |
| `terminal.terminalType` | `string` | No | `"xterm-256color"` | `TERM` value advertised to the shell in pty mode |
| `terminal.cols` | `number` | No | `120` | Default pty width in columns |
| `terminal.rows` | `number` | No | `30` | Default pty height in rows |

### Schema Metadata

The following `.meta()` annotations are used for config UI integration:

| Field | Meta Key | Value |
|-------|----------|-------|
| `terminal` | `label` | `"Terminal"` |
| `terminal.sandboxProvider` | `description` | `"Sandboxing mechanism used to isolate shell commands"` |
| `terminal.interactiveMode` | `description` | `"How interactive sessions attach to the shell. 'pty' gives the shell a real terminal (color, echo, working prompts); 'pipe' uses plain stdio, producing cleaner text with no escape sequences"` |
| `terminal.terminalType` | `description` | `"TERM value advertised to the shell in pty mode"` |
| `terminal.cols` | `description` | `"Default pty width in columns"` |
| `terminal.rows` | `description` | `"Default pty height in rows"` |
| `posix` (root) | `label` | `"POSIX System"` |
| `posix` (root) | `description` | `"Local POSIX filesystem and terminal provider settings"` |

### Sandboxing

The `sandboxProvider` option controls how shell commands are isolated when the caller requests `isolation: "sandbox"`:

- **`"auto"`** (default) — Automatically selects bubblewrap if the `bwrap` executable is available, otherwise falls back
  to `sandbox-exec` on macOS. If neither is available, the provider only supports `isolation: "none"`.
- **`"bubblewrap"`** — Requires the `bwrap` executable. Throws on construction if not installed.
- **`"sandbox-exec"`** — Requires macOS and the `sandbox-exec` executable. Throws on construction if not available.

**Bubblewrap sandbox details (Linux):**

When bubblewrap is active, the sandbox provides:

- Read-only bind mounts for `/etc`, `/usr`, `/lib`, `/lib64`, `/bin`, `/sbin`, and the user's home directory
- Read-write bind mount for the working directory (`--bind`)
- `--chdir` to the working directory
- tmpfs at `/tmp`
- `/proc` and `/dev` access
- Network access via `--share-net`
- Process isolation via `--unshare-all`
- Automatic termination when the parent process exits (`--die-with-parent`)

**sandbox-exec details (macOS):**

When `sandbox-exec` is active, the sandbox uses a deny-by-default profile:

- Reads allowed everywhere (`(allow default)`)
- File writes denied by default (`(deny file-write*)`)
- File writes allowed in the working directory and temp directories (`/tmp`, `/dev`,
  `/private/tmp`, `/private/var/tmp`)
- No network access

## Core Components

### PosixFileSystemProvider

A concrete implementation of the `FileSystemProvider` interface that provides access to the local filesystem.

```typescript
export default class PosixFileSystemProvider implements FileSystemProvider
```

**Constructor:**

```typescript
constructor(options?: PosixFileSystemProviderOptions)
```

The options schema (`PosixFileSystemProviderOptionsSchema`) is an empty object; no configuration is currently required.

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Provider name (`"PosixFilesystemProvider"`) |
| `description` | `string` | Provider description (`"Provides access to a local, posix style filesystem"`) |
| `options` | `PosixFileSystemProviderOptions` | Configuration options passed to the constructor |

**File Operations:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `writeFile` | `writeFile(filePath: string, content: string \| Buffer): Promise<boolean>` | Create or overwrite a file (creates parent directories) |
| `appendFile` | `appendFile(filePath: string, content: string \| Buffer): Promise<boolean>` | Append content to a file (creates the file if it does not exist) |
| `deleteFile` | `deleteFile(filePath: string): Promise<boolean>` | Delete a file; throws if the path does not exist or is not a file |
| `deleteDirectory` | `deleteDirectory(dirPath: string): Promise<boolean>` | Recursively delete a directory; throws for files, symbolic links (checked with `lstat`), missing paths and the filesystem root. Allow-list and protected-root checks are done by `FileSystemService` |
| `readFile` | `readFile(filePath: string): Promise<Buffer \| null>` | Read file content; returns `null` if the file does not exist or cannot be read |
| `rename` | `rename(oldPath: string, newPath: string): Promise<boolean>` | Rename or move a file; throws if the source does not exist or the destination already exists |
| `exists` | `exists(filePath: string): Promise<boolean>` | Check if a path exists |
| `stat` | `stat(filePath: string): Promise<StatLike>` | Get file/directory statistics; returns `{ exists: false, path }` on error |
| `createDirectory` | `createDirectory(dirPath: string, options?: { recursive?: boolean }): Promise<boolean>` | Create a directory; throws if the path exists but is not a directory, or if the parent does not exist (non-recursive) |
| `copy` | `copy(source: string, destination: string, options?: { overwrite?: boolean }): Promise<boolean>` | Copy files or directories; throws if the source does not exist or the destination exists without `overwrite` |

**Search and Listing:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `glob` | `glob(pattern: string, options: GlobOptions): Promise<string[]>` | Find files matching a glob pattern using Bun's `Glob`; returns absolute paths |
| `grep` | `grep(searchString: string \| string[], options: GrepOptions): Promise<GrepResult[]>` | Search for text in files with optional context lines |
| `getDirectoryTree` | `getDirectoryTree(dir: string, options: DirectoryTreeOptions): AsyncGenerator<string>` | Traverse a directory tree, yielding file paths and directory paths (with trailing `/`) |
| `watch` | `watch(dir: string, options: WatchOptions): Promise<PosixFileSystemWatcher>` | Watch a directory for changes with stability-based debouncing |

**`glob` options** (`GlobOptions`):

| Parameter | Type | Description |
|-----------|------|-------------|
| `ignoreFilter` | `(path: string) => boolean` | Returns `true` to exclude a path |
| `absolute` | `boolean` | Return absolute paths (the implementation always sets this to `true`) |
| `includeDirectories` | `boolean` | Include directories in results (default: `false`) |

**`grep` options** (`GrepOptions`):

| Parameter | Type | Description |
|-----------|------|-------------|
| `ignoreFilter` | `(path: string) => boolean` | Returns `true` to exclude a path |
| `includeContent` | `{ linesBefore?: number; linesAfter?: number }` | Include context lines around matches |
| `cwd` | `string` | Absolute directory to search (required) |
| `maxResults` | `number` | Stop after this many matching lines |
| `ignoreCase` | `boolean` | Case-insensitive matching (default: `false`) |

**`getDirectoryTree` options** (`DirectoryTreeOptions`):

| Parameter | Type | Description |
|-----------|------|-------------|
| `ignoreFilter` | `(path: string) => boolean` | Returns `true` to exclude a path |
| `recursive` | `boolean` | Recurse into subdirectories (default: `true`) |

**`watch` options** (`WatchOptions`):

| Parameter | Type | Description |
|-----------|------|-------------|
| `ignoreFilter` | `(path: string) => boolean` | Returns `true` to exclude a path |
| `pollInterval` | `number` | Polling interval in ms for stability checks (default: `1000`) |
| `stabilityThreshold` | `number` | Time in ms a file must remain unchanged before emitting an event (default: `2000`) |

**`PosixFileSystemWatcher`:**

The watcher returned by `watch()` extends `EventEmitter` and implements the `FileSystemWatcher` interface. It emits:

| Event | Listener Signature | Description |
|-------|-------------------|-------------|
| `"add"` | `(filePath: string) => void` | A new file was detected and stabilized |
| `"change"` | `(filePath: string) => void` | An existing file was modified and stabilized |
| `"unlink"` | `(filePath: string) => void` | A file was removed |
| `"error"` | `(error: Error) => void` | An error occurred during watching |

Call `watcher.close()` to stop watching and release resources.

### PosixTerminalProvider

A concrete implementation of the `InteractiveTerminalProvider` interface that provides shell command execution with
support for persistent interactive sessions and optional sandboxing.

```typescript
export default class PosixTerminalProvider implements InteractiveTerminalProvider
```

**Constructor:**

```typescript
constructor(
  app: TokenRingApp,
  terminalService: TerminalService,
  options: PosixTerminalProviderOptions,
)
```

If `sandboxProvider` is `"bubblewrap"` but `bwrap` is not installed, or `"sandbox-exec"` on a non-macOS system or
without the executable, the constructor throws.

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `isInteractive` | `true` | Always `true`; this provider supports interactive sessions |
| `name` | `string` | Provider name (`"PosixTerminalProvider"`) |
| `description` | `string` | Provider description (`"Provides shell command execution on local system"`) |
| `displayName` | `string` | Display name with active sandbox provider (e.g., `"PosixTerminalProvider (sandboxProvider: bubblewrap)"`) |
| `supportedIsolationLevels` | `TerminalIsolationLevel[]` | Isolation levels the provider supports; always includes `"none"`, includes `"sandbox"` if a sandbox provider was detected |
| `app` | `TokenRingApp` | Reference to the Token Ring application |
| `terminalService` | `TerminalService` | Reference to the terminal service |
| `options` | `PosixTerminalProviderOptions` | Configuration options passed to the constructor |

**Command Execution:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `executeCommand` | `executeCommand(command: string, args: string[], options: ExecuteCommandOptions): Promise<ExecuteCommandResult>` | Execute a command with arguments; uses `process.env` |
| `runScript` | `runScript(script: string, options: ExecuteCommandOptions): Promise<ExecuteCommandResult>` | Execute a shell script via `$SHELL -c`; sets `TERM=dumb` and `NO_COLOR=1` |

Both methods return an `ExecuteCommandResult` discriminated union on `status`:

| Status | Additional Fields | Description |
|--------|-------------------|-------------|
| `"success"` | `output: string`, `exitCode: 0` | Command completed successfully |
| `"badExitCode"` | `output: string`, `exitCode: number` | Command exited with a non-zero code |
| `"timeout"` | `output: string` | Command was killed after the timeout; partial output is returned |
| `"unknownError"` | `error: string` | An unexpected error occurred |

**`ExecuteCommandOptions`:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `timeoutSeconds` | `number` | Timeout in seconds; `0` means no timeout |
| `workingDirectory` | `string` | Working directory for the command |
| `writablePaths` | `string[]` | Allow-list write entries; the sandbox write-binds each of these (plus the cwd) |
| `readablePaths` | `string[]` | Read-only allow-list entries |
| `isolation` | `TerminalIsolationLevel` | Isolation level: `"none"`, `"sandbox"`, or `"container"` |

**Interactive Sessions:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `startInteractiveSession` | `startInteractiveSession(options: InteractiveTerminalOptions): Promise<string>` | Start an interactive session; returns a session ID |
| `sendInput` | `sendInput(sessionId: string, input: string): void` | Send input to a session; appends a newline if the input does not end with one |
| `resizeSession` | `resizeSession(sessionId: string, cols: number, rows: number): void` | Resize the pty window; no-op for pipe-mode sessions |
| `collectOutput` | `collectOutput(sessionId: string, fromPosition: number, waitOptions: OutputWaitOptions): InteractiveTerminalOutput` | Collect output from a session starting at `fromPosition` (synchronous) |
| `terminateSession` | `terminateSession(sessionId: string): void` | Terminate a session and release resources; no-op if the session does not exist |
| `getSessionStatus` | `getSessionStatus(sessionId: string): SessionStatus \| null` | Get the status of a session; returns `null` if not found |

**`InteractiveTerminalOptions`:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `workingDirectory` | `string` | Working directory for the session |
| `writablePaths` | `string[]` | Allow-list write entries; the sandbox write-binds each of these (plus the cwd) |
| `readablePaths` | `string[]` | Read-only allow-list entries |
| `isolation` | `TerminalIsolationLevel` | Isolation level for the session |
| `pty` | `boolean` | Attach a pseudo-terminal; overrides `interactiveMode` config (default: provider's `interactiveMode`) |
| `cols` | `number` | PTY width in columns (default: provider's `cols`) |
| `rows` | `number` | PTY height in rows (default: provider's `rows`) |

**`InteractiveTerminalOutput`:**

| Field | Type | Description |
|-------|------|-------------|
| `output` | `string` | Output text since `fromPosition` |
| `newPosition` | `number` | New buffer position for the next `collectOutput` call |
| `isComplete` | `boolean` | Whether the session has exited |
| `exitCode` | `number \| undefined` | Exit code if the session has exited |

**`SessionStatus`:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Session ID |
| `running` | `boolean` | Whether the session is still active |
| `startTime` | `number` | Start time as a Unix timestamp (ms) |
| `outputLength` | `number` | Current output buffer length |
| `exitCode` | `number \| undefined` | Exit code if the session has exited |

## Plugin Lifecycle

This plugin defines no agent lifecycle hooks. It registers providers during the `reconfigure` lifecycle hook.

**Plugin metadata:**

| Field | Value |
|-------|-------|
| name | `@tokenring-ai/posix-system` |
| displayName | `POSIX System` |
| version | `0.2.0` |
| description | `Low-level system utilities for Unix-like environments, including process and signal management.` |
| configSchema | `packageConfigSchema` (`z.object({ posix: PosixConfigSchema.prefault({}) })`) |

**`install(_app)`:**

No-op. Providers are registered in `reconfigure` once config is available.

**`reconfigure(app, config)`:**

Registers a single `"posix"` provider with each service:

1. Waits for `FileSystemService` to be available, then registers a `PosixFileSystemProvider` initialized with
   `config.posix.filesystem`.
2. Waits for `TerminalService` to be available, then registers a `PosixTerminalProvider` initialized with the app
   instance, the terminal service, and `config.posix.terminal`.

Since registration uses `set` (overwrites), `reconfigure` is safe to call repeatedly.

### Plugin Registration

The plugin definition is not re-exported from `index.ts`. Import it from the subpath:

```typescript
import TokenRingApp from "@tokenring-ai/app";
import PluginManager from "@tokenring-ai/app/PluginManager";
import posixSystemPlugin from "@tokenring-ai/posix-system/plugin";

const app = new TokenRingApp({
  app: { workingDirectory, workspaceDirectory, configDirectories },
});

const pluginManager = app.addService(new PluginManager(app));
await pluginManager.installPlugins([posixSystemPlugin]);
```

### Package Exports

| Export | Source |
|--------|--------|
| `PosixFileSystemProvider` | `PosixFileSystemProvider.ts` |
| `PosixTerminalProvider` | `PosixTerminalProvider.ts` |
| `PosixFileSystemProviderOptions` | `schema.ts` (type) |
| `PosixTerminalProviderOptions` | `schema.ts` (type) |
| `PosixConfig` | `schema.ts` (type) |
| `PosixConfigSchema` | `schema.ts` (schema) |
| `PosixFileSystemProviderOptionsSchema` | `schema.ts` (schema) |
| `PosixTerminalProviderOptionsSchema` | `schema.ts` (schema) |
| `default` (plugin) | `plugin.ts` (via subpath import) |

## RPC Endpoints

This package does not define RPC endpoints. It provides providers that are consumed by the `FileSystemService` and
`TerminalService`.

## Usage Examples

### Filesystem Provider

```typescript
import { PosixFileSystemProvider } from "@tokenring-ai/posix-system";

const fsProvider = new PosixFileSystemProvider({});

// Basic file operations
await fsProvider.writeFile("test.txt", "Hello, World!");
const content = await fsProvider.readFile("test.txt");
if (content) {
  console.log(content.toString()); // "Hello, World!"
}

// Check if file exists
const exists = await fsProvider.exists("test.txt");
console.log(exists); // true

// Get file statistics
const stats = await fsProvider.stat("test.txt");
if (stats.exists) {
  console.log(stats.isFile);       // true
  console.log(stats.size);         // 13
  console.log(stats.modified);     // Date object
}

// Directory operations
await fsProvider.createDirectory("subdir", { recursive: true });
await fsProvider.writeFile("subdir/file.txt", "Content");

// Copy files
await fsProvider.copy("test.txt", "test_copy.txt");

// Rename files
await fsProvider.rename("test_copy.txt", "renamed.txt");

// Find files matching patterns
const files = await fsProvider.glob("**/*.txt", {
  ignoreFilter: (file) => file.includes("node_modules"),
  includeDirectories: false,
});
console.log(files); // ["test.txt", "subdir/file.txt", "renamed.txt"]

// Search for text in files with context
const results = await fsProvider.grep("Hello", {
  ignoreFilter: (file) => file.includes("node_modules"),
  includeContent: {
    linesBefore: 1,
    linesAfter: 1,
  },
});
console.log(results);
// [{ file: "test.txt", line: 1, match: "Hello, World!", content: "Hello, World!" }]

// Watch for file changes
const watcher = await fsProvider.watch(".", {
  ignoreFilter: (file) => file.includes("node_modules"),
  pollInterval: 1000,
  stabilityThreshold: 2000,
});

watcher.on("add", (path) => console.log(`File added: ${path}`));
watcher.on("change", (path) => console.log(`File changed: ${path}`));
watcher.on("unlink", (path) => console.log(`File removed: ${path}`));

// Async directory tree traversal
for await (const file of fsProvider.getDirectoryTree(".", {
  ignoreFilter: (file) => file.includes("node_modules"),
  recursive: true,
})) {
  console.log(file);
}
```

### Terminal Provider

```typescript
import { PosixTerminalProvider } from "@tokenring-ai/posix-system";
import TokenRingApp from "@tokenring-ai/app";
import TerminalService from "@tokenring-ai/terminal/TerminalService";

const app = new TokenRingApp({});
const terminalService = app.getService(TerminalService);

const terminalProvider = new PosixTerminalProvider(app, terminalService, {
  sandboxProvider: "auto", // Auto-detect bubblewrap or sandbox-exec
});

// Check supported isolation levels
console.log(terminalProvider.supportedIsolationLevels); // ["none"] or ["none", "sandbox"]

// Execute shell commands with arguments
const result = await terminalProvider.executeCommand("ls", ["-la"], {
  timeoutSeconds: 30,
  workingDirectory: "/tmp",
  isolation: "none",
});

if (result.status === "success") {
  console.log(result.output);
} else if (result.status === "timeout") {
  console.error("Command timed out");
} else if (result.status === "badExitCode") {
  console.error(`Command failed with exit code: ${result.exitCode}`);
  console.error("Output:", result.output);
} else if (result.status === "unknownError") {
  console.error("Unknown error:", result.error);
}

// Run shell scripts
const scriptResult = await terminalProvider.runScript("npm install", {
  timeoutSeconds: 60,
  workingDirectory: "/tmp",
  isolation: "none",
});
```

### Interactive Terminal Sessions

```typescript
import { PosixTerminalProvider } from "@tokenring-ai/posix-system";
import TokenRingApp from "@tokenring-ai/app";
import TerminalService from "@tokenring-ai/terminal/TerminalService";

const app = new TokenRingApp({});
const terminalService = app.getService(TerminalService);

const terminalProvider = new PosixTerminalProvider(app, terminalService, {});

// Start an interactive session (uses provider's interactiveMode config)
const sessionId = await terminalProvider.startInteractiveSession({
  workingDirectory: "/tmp",
  isolation: "none",
});

console.log(`Session started: ${sessionId}`);

// Send input to the session
terminalProvider.sendInput(sessionId, "echo hello");

// Wait briefly for output to appear
await new Promise((resolve) => setTimeout(resolve, 200));

// Collect output (synchronous)
const output = terminalProvider.collectOutput(sessionId, 0, {
  minInterval: 0.1,
  settleInterval: 0.5,
  maxInterval: 5,
});

console.log(output.output);
console.log(`New position: ${output.newPosition}`);
console.log(`Is complete: ${output.isComplete}`);
if (output.exitCode !== undefined) {
  console.log(`Exit code: ${output.exitCode}`);
}

// Get session status
const status = terminalProvider.getSessionStatus(sessionId);
if (status) {
  console.log(`Running: ${status.running}`);
  console.log(`Output length: ${status.outputLength}`);
  console.log(`Start time: ${new Date(status.startTime)}`);
}

// Terminate the session
terminalProvider.terminateSession(sessionId);
```

## Best Practices

### Filesystem Provider Best Practices

1. **Use ignore filters**: When performing glob or grep operations, always provide an ignore filter to respect project
   conventions (e.g., ignore `node_modules`, `.git`).
2. **Handle null returns**: `readFile()` returns `null` for non-existent or unreadable files, so always check for null
   before using the result.
3. **Use recursive operations wisely**: When creating directories or copying, use the `recursive` option to handle nested
   structures.
4. **Memory-efficient traversal**: Use `getDirectoryTree()` async generator for large directory trees to avoid loading
   everything into memory.
5. **Close watchers**: Always call `watcher.close()` when done to release file descriptors and timers.

### Terminal Provider Best Practices

1. **Set appropriate timeouts**: For long-running commands, set `timeoutSeconds` to prevent hanging.
2. **Check supported isolation levels**: Use `supportedIsolationLevels` to determine whether sandboxing is available
   before requesting `isolation: "sandbox"`.
3. **Handle all status types**: Always check the `status` field in command results and handle all possible states
   (`success`, `timeout`, `badExitCode`, `unknownError`).
4. **Manage session lifecycle**: Always terminate interactive sessions when done to free up resources.
5. **Wait for output**: When collecting output from interactive sessions, allow sufficient time for output to appear
   before collecting.

## Dependencies

| Package | Purpose |
|---------|---------|
| `@tokenring-ai/app` | Token Ring application framework and plugin architecture |
| `@tokenring-ai/filesystem` | Abstract filesystem provider interfaces and services |
| `@tokenring-ai/terminal` | Abstract terminal provider interfaces and services |
| `@tokenring-ai/utility` | Utility functions including `arrayableToArray`, `EnhancedMap`, and `formatLogMessages` |
| `fs-extra` | File system utilities (`outputFile`, `appendFile`, `copy`, `pathExists`, etc.) |
| `zod` | Runtime type validation and schema definitions |

**Development dependencies:**

| Package | Purpose |
|---------|---------|
| `@types/fs-extra` | Type definitions for `fs-extra` |
| `typescript` | TypeScript compiler |

## Testing

```bash
bun test
```

Run tests in watch mode:

```bash
bun test --watch
```

Run tests with coverage:

```bash
bun test --coverage
```

The test suite includes integration tests for both providers:

- `test/PosixFileSystemProvider.integration.test.ts` — Tests file operations, directory operations, error handling,
  glob patterns, and watch event detection.
- `test/PosixTerminalProvider.integration.test.ts` — Tests shell command execution, error handling, and timeout
  behavior.
- `test/PosixTerminalProvider.persistent.test.ts` — Tests persistent interactive sessions including pty/pipe modes,
  concurrent sessions, output position tracking, and session lifecycle.

## License

MIT License — see LICENSE file for details.
