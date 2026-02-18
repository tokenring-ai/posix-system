# @tokenring-ai/posix-system

A POSIX system package for TokenRing applications, providing Terminal, Filesystem, and other POSIX-related utilities. This package implements filesystem and terminal providers that enable agents to interact with the local system in a controlled, scoped manner.

## Overview

The `posix-system` package provides two core providers for TokenRing applications:

- **PosixFileSystemProvider**: Safe filesystem operations with root-scoped access
- **PosixTerminalProvider**: Shell command execution with configurable environment, timeouts, and optional sandboxing

Both providers enforce strict security boundaries by operating only within a specified working directory, preventing agents from accessing sensitive system paths outside the designated scope.

## Features

- **Filesystem Provider**: Full-featured filesystem operations with root-scoped access
- **Terminal Provider**: Shell command execution with configurable environment, timeouts, and sandboxing
- **Root-scoped operations**: All operations are confined to the `workingDirectory`; attempts to access paths outside are rejected
- **Ignore-aware**: Most listing/searching methods accept an ignore filter for respecting VCS/IDE ignore rules
- **Watcher-backed**: Uses chokidar for robust file system watching
- **Shell execution**: Uses execa with configurable timeouts and environment overrides
- **Sandboxing support**: Optional bubblewrap sandboxing for command execution (auto-detects availability)
- **Type-safe**: Built with TypeScript and Zod for configuration validation
- **Plugin architecture**: Designed to integrate with Token Ring applications as a plugin
- **Interactive sessions**: Support for persistent interactive terminal sessions
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

The `PosixTerminalProvider` provides shell command execution with optional sandboxing:

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

## Core Components

### PosixFileSystemProvider

A concrete implementation of the `FileSystemProvider` abstraction that provides safe, root-scoped access to the local filesystem for Token Ring apps and agents.

**Constructor Options:**

```typescript
interface LocalFileSystemProviderOptions {
  workingDirectory: string;  // The root directory for all file operations
  defaultSelectedFiles?: string[];  // Default file patterns for selection
}
```

**Properties:**

- `name: string` - Provider name ("LocalFilesystemProvider")
- `description: string` - Provider description ("Provides access to the local filesystem")

**Path Utilities:**

- `relativeOrAbsolutePathToAbsolutePath(p: string): string` - Converts any path to absolute path within bounds. Throws error if path is outside workingDirectory
- `relativeOrAbsolutePathToRelativePath(p: string): string` - Converts absolute path to relative path relative to workingDirectory

**File Operations:**

- `writeFile(filePath: string, content: string | Buffer): Promise<boolean>` - Create or overwrite a file
- `appendFile(filePath: string, content: string | Buffer): Promise<boolean>` - Append content to a file
- `readFile(filePath: string): Promise<Buffer|null>` - Read file content. Returns null if file doesn't exist
- `deleteFile(filePath: string): Promise<boolean>` - Delete a file. Throws error if file doesn't exist
- `rename(oldPath: string, newPath: string): Promise<boolean>` - Rename/move a file. Throws error if source doesn't exist or destination exists
- `exists(filePath: string): Promise<boolean>` - Check if file exists
- `stat(filePath: string): Promise<StatLike>` - Get file/directory statistics

**Directory Operations:**

- `createDirectory(dirPath: string, options?: { recursive?: boolean }): Promise<boolean>` - Create directory
- `copy(source: string, destination: string, options?: { overwrite?: boolean }): Promise<boolean>` - Copy files/directories

**Search and Listing:**

- `glob(pattern: string, options?: GlobOptions): Promise<string[]>` - Find files matching glob patterns
- `grep(searchString: string, options?: GrepOptions): Promise<GrepResult[]>` - Search for text in files with context
- `getDirectoryTree(dir: string, options?: DirectoryTreeOptions): AsyncGenerator<string>` - Traverse directory tree

**File Watching:**

- `watch(dir: string, options?: WatchOptions): Promise<FSWatcher>` - Watch directory for changes

### PosixTerminalProvider

A concrete implementation of the `TerminalProvider` abstraction that provides shell command execution capabilities with support for persistent sessions and optional sandboxing.

**Constructor Options:**

```typescript
interface LocalTerminalProviderOptions {
  workingDirectory: string;  // The root directory for command execution
  isolation?: 'none' | 'bubblewrap' | 'auto';  // Sandboxing mode (default: 'auto')
}
```

**Isolation Modes:**

- `"none"` - No sandboxing, commands run directly on the host system
- `"bubblewrap"` - Commands run in a bubblewrap sandbox with restricted filesystem access
- `"auto"` (default) - Automatically uses bubblewrap if the `bwrap` executable is available, otherwise falls back to none

**Properties:**

- `name: string` - Provider name ("PosixTerminalProvider")
- `description: string` - Provider description ("Provides shell command execution on local system")

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
  input?: string;
}
```

**ExecuteCommandResult:**

```typescript
interface ExecuteCommandResult {
  status: "success" | "timeout" | "badExitCode" | "unknownError";
  output?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
}
```

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

### Filesystem Operations

```typescript
import PosixFileSystemProvider from "@tokenring-ai/posix-system/PosixFileSystemProvider";

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
console.log(stats.size);      // 13
console.log(stats.modified);  // Date object

// Directory operations
await fsProvider.createDirectory("subdir", { recursive: true });
await fsProvider.writeFile("subdir/file.txt", "Content");

// Find files matching patterns
const files = await fsProvider.glob("**/*.txt", {
  ignoreFilter: (file) => file.includes("node_modules")
});
console.log(files);  // ["test.txt", "subdir/file.txt"]

// Search for text in files
const results = await fsProvider.grep("Hello", {
  ignoreFilter: (file) => file.includes("node_modules")
});
console.log(results);
// [
//   { file: "test.txt", line: 1, match: "Hello, World!", content: null }
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
```

### Terminal Operations

```typescript
import PosixTerminalProvider from "@tokenring-ai/posix-system/PosixTerminalProvider";

const terminalProvider = new PosixTerminalProvider(app, {
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
}
```

### Interactive Terminal Sessions

```typescript
import PosixTerminalProvider from "@tokenring-ai/posix-system/PosixTerminalProvider";

const terminalProvider = new PosixTerminalProvider(app, {
  workingDirectory: process.cwd()
});

// Start an interactive session
const sessionId = await terminalProvider.startInteractiveSession({
  workingDirectory: ".",
  timeoutSeconds: 0,
});

console.log(`Session started: ${sessionId}`);

// Send input to the session
await terminalProvider.sendInput(sessionId, "echo hello\n");

// Wait a bit for output
await new Promise(resolve => setTimeout(resolve, 100));

// Collect output
const output = await terminalProvider.collectOutput(sessionId, 0, {
  minInterval: 0.1,
  settleInterval: 0.5,
  maxInterval: 5,
});

console.log(output.output);
console.log(`Position: ${output.newPosition}`);
console.log(`Complete: ${output.isComplete}`);
console.log(`Exit code: ${output.exitCode}`);

// Get session status
const status = terminalProvider.getSessionStatus(sessionId);
if (status) {
  console.log(`Running: ${status.running}`);
  console.log(`Output length: ${status.outputLength}`);
}

// Terminate the session
await terminalProvider.terminateSession(sessionId);
```

### Path Resolution

```typescript
// Relative paths are resolved relative to workingDirectory
const absPath = fsProvider.relativeOrAbsolutePathToAbsolutePath("file.txt");
const relPath = fsProvider.relativeOrAbsolutePathToRelativePath(absPath);

// Absolute paths outside workingDirectory throw an error
try {
  fsProvider.relativeOrAbsolutePathToAbsolutePath("/etc/passwd");
} catch (error) {
  console.error(error.message);  // "Path /etc/passwd is outside the root directory"
}
```

### Grep with Context

```typescript
const results = await fsProvider.grep("error", {
  ignoreFilter: (file) => file.includes("node_modules"),
  includeContent: {
    linesBefore: 2,
    linesAfter: 2
  }
});

console.log(results.map(r => ({
  file: r.file,
  line: r.line,
  match: r.match,
  context: r.content
})));
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
  isolation?: "none" | "bubblewrap" | "auto";
}
```

### StatLike

```typescript
interface StatLike {
  exists: boolean;
  path: string;
  absolutePath: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  size: number;
  created: Date;
  modified: Date;
  accessed: Date;
}
```

### GrepResult

```typescript
interface GrepResult {
  file: string;
  line: number;
  match: string;
  content: string | null;
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

## Error Handling

The providers include comprehensive error handling:

- **Security**: Paths outside the working directory throw errors with descriptive messages
- **Existence checks**: Operations on non-existent paths throw appropriate errors
- **Type safety**: Operations on directories when files are expected (and vice versa) throw errors
- **Command execution**: Failed commands return detailed error information without throwing
- **Session management**: Sessions are properly tracked and cleaned up on termination
- **Permission errors**: Graceful handling of permission errors where possible

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

The test suite includes integration tests covering file operations, terminal execution, error handling, and edge cases.

## Dependencies

### Production Dependencies

- `@tokenring-ai/app`: Token Ring application framework
- `@tokenring-ai/chat`: Chat functionality
- `@tokenring-ai/terminal`: Abstract terminal interfaces
- `@tokenring-ai/agent`: Agent framework
- `@tokenring-ai/filesystem`: Abstract filesystem interfaces
- `@tokenring-ai/utility`: Utility functions
- `zod`: Runtime type validation
- `chokidar`: File system watching
- `execa`: Shell command execution
- `fs-extra`: File system utilities
- `glob`: Glob pattern matching
- `bun-pty`: Terminal emulation

### Development Dependencies

- `@types/fs-extra`: File system type definitions
- `vitest`: Testing framework
- `typescript`: TypeScript compiler

## License

MIT License - see [LICENSE](./LICENSE) file for details.
