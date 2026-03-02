# @tokenring-ai/posix-system

A POSIX system package for TokenRing applications, providing Terminal, Filesystem, and other POSIX-related utilities. This package implements filesystem and terminal providers that enable agents to interact with the local system in a controlled, scoped manner.

## Overview

The `posix-system` package provides two core providers for TokenRing applications:

- **PosixFileSystemProvider**: Safe filesystem operations with root-scoped access
- **PosixTerminalProvider**: Shell command execution with configurable environment, timeouts, and optional bubblewrap sandboxing

Both providers enforce strict security boundaries by operating only within a specified working directory, preventing agents from accessing sensitive system paths outside the designated scope.

## Features

- **Filesystem Provider**: Full-featured filesystem operations with root-scoped access
- **Terminal Provider**: Shell command execution with configurable environment, timeouts, and sandboxing
- **Root-scoped operations**: All operations are confined to the `workingDirectory`; attempts to access paths outside are rejected
- **Ignore-aware**: Most listing/searching methods accept an ignore filter for respecting VCS/IDE ignore rules
- **Watcher-backed**: Uses chokidar for robust file system watching
- **Shell execution**: Uses execa with configurable timeouts and environment overrides
- **Bubblewrap sandboxing**: Optional bubblewrap sandboxing for command execution (auto-detects availability)
- **Type-safe**: Built with TypeScript and Zod for configuration validation
- **Plugin architecture**: Designed to integrate with Token Ring applications as a plugin
- **Interactive sessions**: Support for persistent interactive terminal sessions with PTY
- **Comprehensive error handling**: Detailed error messages for security violations and operation failures

## Installation

This package is part of the Token Ring monorepo. Add it to your dependencies:

```bash
bun add @tokenring-ai/posix-system
```

```json
{
  "dependencies": {
    "@tokenring-ai/posix-system": "0.2.0"
  }
}
```

## Plugin Configuration

The package is designed to be used as a Token Ring plugin with filesystem and terminal providers.

### Filesystem Provider

The `PosixFileSystemProvider` provides filesystem operations with root-scoped access:

```json
{
  "config": {
    "filesystem": {
      "providers": {
        "posix": {
          "type": "posix",
          "workingDirectory": "/path/to/your/project",
          "defaultSelectedFiles": ["**/*.ts", "**/*.js"]
        }
      }
    }
  }
}
```

### Terminal Provider

The `PosixTerminalProvider` provides shell command execution with optional bubblewrap sandboxing:

```json
{
  "config": {
    "terminal": {
      "providers": {
        "posix": {
          "type": "posix",
          "workingDirectory": "/path/to/your/project",
          "isolation": "auto"
        }
      }
    }
  }
}
```

**Isolation Modes:**

- `"none"` - No sandboxing, commands run directly on the host system
- `"bubblewrap"` - Commands run in a bubblewrap sandbox with restricted filesystem access
- `"auto"` (default) - Automatically uses bubblewrap if the `bwrap` executable is available, otherwise falls back to none

**Bubblewrap Sandboxing Details:**

When bubblewrap is enabled, the sandbox provides:
- Read-only access to system directories (`/usr`, `/lib`, `/lib64`, `/bin`, `/sbin`, `/etc`)
- Read-write access only to the working directory
- Temporary `/tmp` directory (tmpfs)
- Access to `/proc` and `/dev`
- Network access (via `--share-net`)
- Process isolation with `--unshare-all`
- Automatic termination when parent process exits (`--die-with-parent`)

## Core Components

### PosixFileSystemProvider

A concrete implementation of the `FileSystemProvider` abstraction that provides safe, root-scoped access to the local filesystem for Token Ring apps and agents.

**Constructor:**

```typescript
constructor(options: LocalFileSystemProviderOptions)
```

**Options:**

```typescript
interface LocalFileSystemProviderOptions {
  workingDirectory: string;  // The root directory for all file operations
  defaultSelectedFiles?: string[];  // Default file patterns for selection
}
```

**Properties:**

- `name: string` - Provider name ("LocalFilesystemProvider")
- `description: string` - Provider description ("Provides access to the local filesystem")
- `options: LocalFileSystemProviderOptions` - Configuration options

**Path Utilities:**

- `relativeOrAbsolutePathToAbsolutePath(p: string): string` - Converts any path to absolute path within bounds. Throws error if path is outside workingDirectory
- `relativeOrAbsolutePathToRelativePath(p: string): string` - Converts absolute path to relative path relative to workingDirectory

**File Operations:**

- `writeFile(filePath: string, content: string | Buffer): Promise<boolean>` - Create or overwrite a file
- `appendFile(filePath: string, content: string | Buffer): Promise<boolean>` - Append content to a file
- `readFile(filePath: string): Promise<Buffer | null>` - Read file content. Returns null if file doesn't exist
- `deleteFile(filePath: string): Promise<boolean>` - Delete a file. Throws error if file doesn't exist or is not a file
- `rename(oldPath: string, newPath: string): Promise<boolean>` - Rename/move a file. Throws error if source doesn't exist or destination exists
- `exists(filePath: string): Promise<boolean>` - Check if file exists
- `stat(filePath: string): Promise<StatLike>` - Get file/directory statistics

**Directory Operations:**

- `createDirectory(dirPath: string, options?: { recursive?: boolean }): Promise<boolean>` - Create directory
- `copy(source: string, destination: string, options?: { overwrite?: boolean }): Promise<boolean>` - Copy files/directories

**Search and Listing:**

- `glob(pattern: string, options?: GlobOptions): Promise<string[]>` - Find files matching glob patterns
- `grep(searchString: string, options?: GrepOptions): Promise<GrepResult[]>` - Search for text in files with optional context
- `getDirectoryTree(dir: string, options?: DirectoryTreeOptions): AsyncGenerator<string>` - Traverse directory tree asynchronously

**File Watching:**

- `watch(dir: string, options?: WatchOptions): Promise<FSWatcher>` - Watch directory for changes using chokidar

### PosixTerminalProvider

A concrete implementation of the `TerminalProvider` abstraction that provides shell command execution capabilities with support for persistent interactive sessions and optional bubblewrap sandboxing.

**Constructor:**

```typescript
constructor(app: TokenRingApp, terminalService: TerminalService, options: LocalTerminalProviderOptions)
```

**Options:**

```typescript
interface LocalTerminalProviderOptions {
  workingDirectory: string;  // The root directory for command execution
  isolation?: 'auto' | 'none' | 'bubblewrap';  // Sandboxing mode (default: 'auto')
}
```

**Properties:**

- `name: string` - Provider name ("PosixTerminalProvider")
- `description: string` - Provider description ("Provides shell command execution on local system")
- `app: TokenRingApp` - Reference to the Token Ring application
- `terminalService: TerminalService` - Reference to the terminal service
- `options: LocalTerminalProviderOptions` - Configuration options

**Methods:**

- `executeCommand(command: string, args: string[], options: ExecuteCommandOptions): Promise<ExecuteCommandResult>` - Execute shell commands with arguments
- `runScript(script: string, options: ExecuteCommandOptions): Promise<ExecuteCommandResult>` - Execute shell scripts
- `startInteractiveSession(options: ExecuteCommandOptions): Promise<string>` - Start an interactive terminal session, returns session ID
- `sendInput(sessionId: string, input: string): Promise<void>` - Send input to a session
- `collectOutput(sessionId: string, fromPosition: number, waitOptions: OutputWaitOptions): Promise<InteractiveTerminalOutput>` - Collect output from a session
- `terminateSession(sessionId: string): Promise<void>` - Terminate a session
- `getSessionStatus(sessionId: string): SessionStatus | null` - Get status of a session
- `getIsolationLevel(): TerminalIsolationLevel` - Get the active isolation level ('none' or 'sandbox')

**ExecuteCommandOptions:**

```typescript
interface ExecuteCommandOptions {
  timeoutSeconds?: number;
  env?: Record<string, string>;
  workingDirectory?: string;
  input?: string;  // Not currently used for non-interactive commands
}
```

**ExecuteCommandResult:**

```typescript
interface ExecuteCommandResult {
  status: "success" | "timeout" | "badExitCode" | "unknownError";
  output?: string;      // Combined stdout and stderr (only present for success)
  exitCode?: number;    // Exit code (only present for badExitCode)
  error?: string;       // Error message (only present for unknownError)
}
```

**Isolation Level:**

- `getIsolationLevel(): TerminalIsolationLevel` - Returns either `'none'` or `'sandbox'`

## Usage Examples

### As a Token Ring Plugin

The primary usage is as a plugin within a Token Ring application:

```typescript
import TokenRingApp from "@tokenring-ai/app";
import posixSystemPlugin from "@tokenring-ai/posix-system";

const app = new TokenRingApp({
  config: {
    filesystem: {
      providers: {
        posix: {
          type: "posix",
          workingDirectory: process.cwd(),
          defaultSelectedFiles: ["**/*.ts", "**/*.js"]
        }
      }
    },
    terminal: {
      providers: {
        posix: {
          type: "posix",
          workingDirectory: process.cwd(),
          isolation: "auto"
        }
      }
    }
  }
});

app.use(posixSystemPlugin);
await app.start();
```

### Filesystem Provider Usage

```typescript
import { PosixFileSystemProvider } from "@tokenring-ai/posix-system";

const fsProvider = new PosixFileSystemProvider({
  workingDirectory: process.cwd(),
  defaultSelectedFiles: ["**/*.ts", "**/*.js"]
});

// Basic file operations
await fsProvider.writeFile("test.txt", "Hello, World!");
const content = await fsProvider.readFile("test.txt");
if (content) {
  console.log(content.toString());  // "Hello, World!"
}

// Check if file exists
const exists = await fsProvider.exists("test.txt");
console.log(exists);  // true

// Get file statistics
const stats = await fsProvider.stat("test.txt");
console.log(stats.isFile);       // true
console.log(stats.size);         // 13
console.log(stats.modified);     // Date object

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
  includeDirectories: false
});
console.log(files);  // ["test.txt", "subdir/file.txt", "renamed.txt"]

// Search for text in files with context
const results = await fsProvider.grep("Hello", {
  ignoreFilter: (file) => file.includes("node_modules"),
  includeContent: {
    linesBefore: 1,
    linesAfter: 1
  }
});
console.log(results);
// [
//   { 
//     file: "test.txt", 
//     line: 1, 
//     match: "Hello, World!", 
//     content: "Hello, World!" 
//   }
// ]

// Watch for file changes
const watcher = await fsProvider.watch(".", {
  ignoreFilter: (file) => file.includes("node_modules"),
  pollInterval: 1000,
  stabilityThreshold: 2000
});

watcher.on('change', (path) => {
  console.log(`File changed: ${path}`);
});

watcher.on('add', (path) => {
  console.log(`File added: ${path}`);
});

watcher.on('unlink', (path) => {
  console.log(`File removed: ${path}`);
});
```

### Terminal Provider Usage

```typescript
import { PosixTerminalProvider } from "@tokenring-ai/posix-system";
import TokenRingApp from "@tokenring-ai/app";
import { TerminalService } from "@tokenring-ai/terminal";

// Note: PosixTerminalProvider requires app and terminalService instances
const app = new TokenRingApp({});
const terminalService = app.getService(TerminalService);

const terminalProvider = new PosixTerminalProvider(app, terminalService, {
  workingDirectory: process.cwd(),
  isolation: "auto"  // Auto-detect bubblewrap, or use 'none' or 'bubblewrap'
});

// Check isolation level
const isolationLevel = terminalProvider.getIsolationLevel();
console.log(`Running with isolation: ${isolationLevel}`);  // 'none' or 'sandbox'

// Execute shell commands with arguments
const result = await terminalProvider.executeCommand("ls", ["-la"], {
  workingDirectory: ".",
  timeoutSeconds: 30,
  env: { CUSTOM_VAR: "value" }
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
  workingDirectory: ".",
  timeoutSeconds: 60
});

if (scriptResult.status === "success") {
  console.log(scriptResult.output);
} else if (scriptResult.status === "badExitCode") {
  console.error(`Script failed with exit code: ${scriptResult.exitCode}`);
  console.error("Output:", scriptResult.output);
}
```

### Interactive Terminal Sessions

```typescript
import { PosixTerminalProvider } from "@tokenring-ai/posix-system";
import TokenRingApp from "@tokenring-ai/app";
import { TerminalService } from "@tokenring-ai/terminal";

const app = new TokenRingApp({});
const terminalService = app.getService(TerminalService);

const terminalProvider = new PosixTerminalProvider(app, terminalService, {
  workingDirectory: process.cwd()
});

// Start an interactive session
const sessionId = await terminalProvider.startInteractiveSession({
  workingDirectory: ".",
  timeoutSeconds: 0,  // No timeout for interactive sessions
});

console.log(`Session started: ${sessionId}`);

// Send input to the session
await terminalProvider.sendInput(sessionId, "echo hello");

// Wait briefly for output to appear
await new Promise(resolve => setTimeout(resolve, 200));

// Collect output
const output = await terminalProvider.collectOutput(sessionId, 0, {
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
await terminalProvider.terminateSession(sessionId);
```

### Path Resolution

```typescript
// Relative paths are resolved relative to workingDirectory
const absPath = fsProvider.relativeOrAbsolutePathToAbsolutePath("file.txt");
// Returns: "/path/to/working/dir/file.txt"

const relPath = fsProvider.relativeOrAbsolutePathToRelativePath(absPath);
// Returns: "file.txt"

// Absolute paths outside workingDirectory throw an error
try {
  fsProvider.relativeOrAbsolutePathToAbsolutePath("/etc/passwd");
} catch (error) {
  console.error(error.message);  // "Path /etc/passwd is outside the root directory"
}
```

### Glob with Include Directories

```typescript
const items = await fsProvider.glob("**", {
  ignoreFilter: (file) => file.includes("node_modules"),
  includeDirectories: true
});

console.log(items);
// [ "file1.txt", "file2.js", "src/", "src/lib.ts", "docs/", "docs/README.md" ]
```

## Type Definitions

### LocalFileSystemProviderOptions

```typescript
interface LocalFileSystemProviderOptions {
  workingDirectory: string;
  defaultSelectedFiles?: string[];
}
```

### LocalTerminalProviderOptions

```typescript
interface LocalTerminalProviderOptions {
  workingDirectory: string;
  isolation?: "auto" | "none" | "bubblewrap";
}
```

### StatLike

```typescript
interface StatLike {
  exists: boolean;
  path: string;
  absolutePath?: string;
  isFile?: boolean;
  isDirectory?: boolean;
  isSymbolicLink?: boolean;
  size?: number;
  created?: Date;
  modified?: Date;
  accessed?: Date;
}
```

### GrepResult

```typescript
interface GrepResult {
  file: string;
  line: number;
  match: string;
  content: string | null;  // Context lines if includeContent is specified
}
```

### GlobOptions

```typescript
interface GlobOptions {
  ignoreFilter?: (file: string) => boolean;
  includeDirectories?: boolean;
}
```

### GrepOptions

```typescript
interface GrepOptions {
  ignoreFilter?: (file: string) => boolean;
  includeContent?: {
    linesBefore?: number;
    linesAfter?: number;
  };
}
```

### WatchOptions

```typescript
interface WatchOptions {
  ignoreFilter?: (file: string) => boolean;
  pollInterval?: number;
  stabilityThreshold?: number;
}
```

### DirectoryTreeOptions

```typescript
interface DirectoryTreeOptions {
  ignoreFilter?: (file: string) => boolean;
  recursive?: boolean;
}
```

### SessionStatus

```typescript
interface SessionStatus {
  id: string;
  running: boolean;
  startTime: number;
  outputLength: number;
  exitCode?: number;
}
```

### InteractiveTerminalOutput

```typescript
interface InteractiveTerminalOutput {
  output: string;
  newPosition: number;
  isComplete: boolean;
  exitCode?: number;
}
```

### ExecuteCommandOptions

```typescript
interface ExecuteCommandOptions {
  timeoutSeconds?: number;
  env?: Record<string, string>;
  workingDirectory?: string;
  input?: string;
}
```

### ExecuteCommandResult

```typescript
interface ExecuteCommandResult {
  status: "success" | "timeout" | "badExitCode" | "unknownError";
  output?: string;
  exitCode?: number;
  error?: string;
}
```

### TerminalIsolationLevel

```typescript
type TerminalIsolationLevel = "none" | "sandbox";
```

## Error Handling

The providers include comprehensive error handling:

### Filesystem Provider Errors

- **Path outside root directory**: Throws `Error` with message "Path {path} is outside the root directory"
- **File not found**: 
  - `readFile()` returns `null`
  - `deleteFile()` throws `Error` with message "File {path} does not exist"
- **Not a file**: `deleteFile()` throws `Error` with message "Path {path} is not a file"
- **Directory exists**: `createDirectory()` throws `Error` if path exists but is not a directory
- **Destination exists**: `rename()` and `copy()` throw errors if destination already exists
- **Permission errors**: Gracefully handled where possible, may throw system-specific errors

### Terminal Provider Errors

- **Command timeout**: Returns result with `status: "timeout"`
- **Bad exit code**: Returns result with `status: "badExitCode"` and includes `exitCode` and `output`
- **Unknown errors**: Returns result with `status: "unknownError"` and includes error message
- **Session not found**: Methods operating on sessions throw `Error` if session ID is not found
- **Directory not found**: Constructor throws `Error` if workingDirectory does not exist

### Error Handling Examples

```typescript
// Filesystem error handling
try {
  await fsProvider.deleteFile("nonexistent.txt");
} catch (error) {
  console.error(error.message);  // "File nonexistent.txt does not exist"
}

// Path security error handling
try {
  fsProvider.relativeOrAbsolutePathToAbsolutePath("/etc/passwd");
} catch (error) {
  console.error(error.message);  // "Path /etc/passwd is outside the root directory"
}

// Terminal command error handling
const result = await terminalProvider.executeCommand("false", [], {
  timeoutSeconds: 5
});

if (result.status === "badExitCode") {
  console.error(`Command failed with exit code: ${result.exitCode}`);
  console.error("Output:", result.output);
}

// Session error handling
try {
  await terminalProvider.sendInput("invalid-session-id", "echo hello");
} catch (error) {
  console.error(error.message);  // "Session invalid-session-id not found"
}
```

## Integration

### Plugin Registration

The package exports a default plugin that can be registered with a Token Ring application:

```typescript
import posixSystemPlugin from "@tokenring-ai/posix-system";

app.use(posixSystemPlugin);
```

### Service Registration

The plugin automatically registers providers with the appropriate services:

- **FileSystemService**: Registers `PosixFileSystemProvider` instances based on configuration
- **TerminalService**: Registers `PosixTerminalProvider` instances based on configuration

### Configuration Schema

The plugin uses Zod schemas for configuration validation:

```typescript
import {LocalFileSystemProviderOptionsSchema, LocalTerminalProviderOptionsSchema} from "@tokenring-ai/posix-system/schema";
```

## Testing

Run the test suite:

```bash
bun run test
```

Run tests in watch mode:

```bash
bun run test:watch
```

Run tests with coverage:

```bash
bun run test:coverage
```

Build the project to check for TypeScript errors:

```bash
bun run build
```

### Test Structure

The package includes integration tests for both providers:

- **PosixFileSystemProvider.integration.test.ts**: Tests file operations, path resolution, error handling, and glob/search operations
- **PosixTerminalProvider.integration.test.ts**: Tests shell command execution and error handling

### Running Specific Tests

```bash
# Run filesystem provider tests
bun run test PosixFileSystemProvider

# Run terminal provider tests
bun run test PosixTerminalProvider
```

## Dependencies

### Production Dependencies

- `@tokenring-ai/app` (0.2.0): Token Ring application framework
- `@tokenring-ai/chat` (0.2.0): Chat functionality
- `@tokenring-ai/terminal` (0.2.0): Abstract terminal interfaces and services
- `@tokenring-ai/agent` (0.2.0): Agent framework
- `@tokenring-ai/filesystem` (0.2.0): Abstract filesystem interfaces
- `@tokenring-ai/utility` (0.2.0): Utility functions including message formatting
- `zod` (^4.3.6): Runtime type validation
- `chokidar` (^5.0.0): File system watching
- `execa` (^9.6.1): Shell command execution
- `fs-extra` (^11.3.3): File system utilities
- `glob` (^13.0.6): Glob pattern matching
- `glob-gitignore` (^1.0.15): Gitignore-aware glob patterns
- `bun-pty` (^0.4.8): Terminal emulation and PTY management

### Development Dependencies

- `@types/fs-extra` (^11.0.4): File system type definitions
- `vitest` (^4.0.18): Testing framework
- `typescript` (^5.9.3): TypeScript compiler

## Best Practices

### Filesystem Provider

1. **Always use relative paths**: When working with the provider, use relative paths. The provider will resolve them to absolute paths within the working directory.

2. **Use ignore filters**: When performing glob or grep operations, always provide an ignore filter to respect project conventions (e.g., ignore `node_modules`, `.git`, etc.).

3. **Check existence before operations**: Use `exists()` or `stat()` to check if a file/directory exists before performing operations that might fail.

4. **Handle null returns**: `readFile()` returns `null` for non-existent files, so always check for null before using the result.

5. **Use recursive operations wisely**: When creating directories or copying, consider using the `recursive` option to handle nested structures.

### Terminal Provider

1. **Set appropriate timeouts**: For long-running commands, set `timeoutSeconds` to prevent hanging. Use `0` for interactive sessions.

2. **Check isolation level**: Always check the isolation level using `getIsolationLevel()` to understand the security context of command execution.

3. **Handle all status types**: Always check the `status` field in command results and handle all possible states (`success`, `timeout`, `badExitCode`, `unknownError`).

4. **Manage session lifecycle**: For interactive sessions, always terminate them when done to free up resources.

5. **Use proper environment variables**: When setting environment variables, merge with `process.env` to preserve system variables.

6. **Wait for output**: When collecting output from interactive sessions, allow sufficient time for output to appear before collecting.

## Related Components

- **@tokenring-ai/terminal**: Abstract terminal provider interfaces and services
- **@tokenring-ai/filesystem**: Abstract filesystem provider interfaces and services
- **@tokenring-ai/app**: Base application framework with plugin architecture
- **@tokenring-ai/agent**: Agent orchestration and tool integration

## License

MIT License - see [LICENSE](./LICENSE) file for details.
