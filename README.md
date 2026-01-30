# @tokenring-ai/posix-system

## Overview

Implements Posix

A concrete implementation of the FileSystemProvider abstraction that provides safe, root-scoped access to the local filesystem for Token Ring apps and agents.

## Integration

- `@tokenring-ai/app`: Token Ring application framework
- `@tokenring-ai/filesystem`: Abstract filesystem interfaces and utilities
- `@tokenring-ai/agent`: Agent framework

## Features

- **Root-scoped**: All operations are confined to the `baseDirectory`; attempts to access paths outside are rejected
- **Ignore-aware**: Most listing/searching methods accept an ignore filter for respecting VCS/IDE ignore rules
- **Watcher-backed**: Uses chokidar for robust file system watching
- **Shell execution**: Uses execa with configurable timeouts and environment overrides
- **Type-safe**: Built with TypeScript and Zod for configuration validation
- **Plugin architecture**: Designed to integrate with Token Ring applications as a plugin
- **Zod validation**: Configuration schema built with Zod for runtime validation

## Installation

This package is part of the Token Ring monorepo. Add it to your dependencies:

```bash
bun add @tokenring-ai/local-filesystem
```

```json
{
  "dependencies": {
    "@tokenring-ai/local-filesystem": "0.2.0"
  }
}
```

## Core Components/API

### Constructor

```ts
new LocalFileSystemProvider(options: LocalFileSystemProviderOptions)
```

**Options:**
- `baseDirectory: string` - The root directory for all file operations (required)
- `defaultSelectedFiles?: string[]` - Default file patterns for selection (optional)

### Properties

- `name: string` - Provider name ("LocalFilesystemProvider")
- `description: string` - Provider description ("Provides access to the local filesystem")

### Path Utilities

- `relativeOrAbsolutePathToAbsolutePath(p: string): string` - Converts any path to absolute path within bounds
- `relativeOrAbsolutePathToRelativePath(p: string): string` - Converts absolute path to relative path

### File Operations

- `writeFile(filePath: string, content: string | Buffer): Promise<boolean>` - Create or overwrite a file
- `appendFile(filePath: string, content: string | Buffer): Promise<boolean>` - Append content to a file
- `readFile(filePath: string): Promise<Buffer|null>` - Read file content
- `deleteFile(filePath: string): Promise<boolean>` - Delete a file
- `rename(oldPath: string, newPath: string): Promise<boolean>` - Rename/move a file
- `exists(filePath: string): Promise<boolean>` - Check if file exists
- `stat(filePath: string): Promise<StatLike>` - Get file/directory statistics
- `chmod(filePath: string, mode: number): Promise<boolean>` - Change file permissions

### Directory Operations

- `createDirectory(dirPath: string, options?: { recursive?: boolean }): Promise<boolean>` - Create directory
- `copy(source: string, destination: string, options?: { overwrite?: boolean }): Promise<boolean>` - Copy files/directories

### Search and Listing

- `glob(pattern: string, options?: GlobOptions): Promise<string>` - Find files matching glob patterns
- `grep(searchString: string, options?: GrepOptions): Promise<GrepResult[]>` - Search for text in files
- `getDirectoryTree(dir: string, options?: DirectoryTreeOptions): AsyncGenerator<string>` - Traverse directory tree

### File Watching

- `watch(dir: string, options?: WatchOptions): Promise<FSWatcher>` - Watch directory for changes

### Command Execution

- `executeCommand(command: string | string[], options?: ExecuteCommandOptions): Promise<ExecuteCommandResult>` - Execute shell commands

## Type Definitions

### LocalFileSystemProviderOptions

```ts
interface LocalFileSystemProviderOptions {
  baseDirectory: string;
  defaultSelectedFiles?: string[];
}
```

### StatLike

```ts
interface StatLike {
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

### ExecuteCommandResult

```ts
interface ExecuteCommandResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: string;
}
```

### GrepResult

```ts
interface GrepResult {
  file: string;
  line: number;
  match: string;
  content: string | null;
}
```

### GlobOptions

```ts
interface GlobOptions {
  ignoreFilter?: (file: string) => boolean;
  includeDirectories?: boolean;
}
```

### GrepOptions

```ts
interface GrepOptions {
  ignoreFilter?: (file: string) => boolean;
  includeContent?: {
    linesBefore?: number;
    linesAfter?: number;
  };
}
```

### WatchOptions

```ts
interface WatchOptions {
  ignoreFilter?: (file: string) => boolean;
  pollInterval?: number;
  stabilityThreshold?: number;
}
```

### DirectoryTreeOptions

```ts
interface DirectoryTreeOptions {
  ignoreFilter?: (file: string) => boolean;
  recursive?: boolean;
}
```

### ExecuteCommandOptions

```ts
interface ExecuteCommandOptions {
  timeoutSeconds?: number;
  env?: Record<string, string>;
  workingDirectory?: string;
}
```

## Usage Examples

### As a Token Ring Plugin

The primary usage is as a plugin within a Token Ring application:

```ts
import TokenRingApp from "@tokenring-ai/app";
import localFilesystemPlugin from "@tokenring-ai/local-filesystem";

const app = new TokenRingApp({
  config: {
    filesystem: {
      providers: {
        local: {
          type: "local",
          baseDirectory: process.cwd(),
          defaultSelectedFiles: ["**/*.ts", "**/*.js"]
        }
      }
    }
  }
});

app.use(localFilesystemPlugin);
await app.start();
```

### Direct Class Usage

You can also use the class directly:

```ts
import LocalFileSystemProvider from "@tokenring-ai/local-filesystem";

const fsProvider = new LocalFileSystemProvider({
  baseDirectory: process.cwd(),
  defaultSelectedFiles: ["**/*.ts", "**/*.js"]
});

// Basic file operations
await fsProvider.writeFile("test.txt", "Hello, World!");
const content = await fsProvider.readFile("test.txt");
console.log(content); // Buffer containing the file content

// Check if file exists
const exists = await fsProvider.exists("test.txt");
console.log(exists); // true

// Get file statistics
const stats = await fsProvider.stat("test.txt");
console.log(stats.size); // 13
console.log(stats.modified); // Date object

// Directory operations
await fsProvider.createDirectory("subdir", { recursive: true });
await fsProvider.writeFile("subdir/file.txt", "Content");

// Find files matching patterns
const files = await fsProvider.glob("**/*.txt");
console.log(files); // ["test.txt", "subdir/file.txt"]

// Search for text in files
const results = await fsProvider.grep("Hello");
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

// Execute shell commands
const result = await fsProvider.executeCommand("ls -la", {
  workingDirectory: ".",
  timeoutSeconds: 30,
  env: { CUSTOM_VAR: "value" }
});

if (result.ok) {
  console.log(result.stdout);
} else {
  console.error(result.stderr);
}
```

### Path Resolution

The provider handles both relative and absolute paths safely:

```ts
// Relative paths are resolved relative to baseDirectory
const absPath = fsProvider.relativeOrAbsolutePathToAbsolutePath("file.txt");
const relPath = fsProvider.relativeOrAbsolutePathToRelativePath(absPath);

// Absolute paths outside baseDirectory throw an error
try {
  fsProvider.relativeOrAbsolutePathToAbsolutePath("/etc/passwd");
} catch (error) {
  console.error(error.message); // "Path /etc/passwd is outside the root directory"
}
```

### Grep with Context

Search for text with line context to see surrounding code:

```ts
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

Find both files and directories:

```ts
const items = await fsProvider.glob("**", {
  ignoreFilter: (file) => file.includes("node_modules"),
  includeDirectories: true
});

console.log(items);
// ["file1.txt", "file2.js", "src/", "src/lib.ts", "docs/", "docs/README.md"]
```

### Plugin Configuration

When using as a plugin, configure it in your app's filesystem config:

```json
{
  "filesystem": {
    "providers": {
      "local": {
        "type": "local",
        "baseDirectory": "/path/to/your/project",
        "defaultSelectedFiles": ["**/*.ts", "**/*.js", "**/*.md"]
      }
    }
  }
}
```

## Error Handling

The provider includes comprehensive error handling:

- **Security**: Paths outside the base directory throw errors
- **Existence checks**: Operations on non-existent paths throw appropriate errors
- **Type safety**: Operations on directories when files are expected (and vice versa) throw errors
- **Command execution**: Failed commands return detailed error information without throwing
- **File permissions**: Graceful handling of permission errors where possible

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

The test suite includes integration tests covering file operations, error handling, and edge cases.

## Dependencies

- `@tokenring-ai/app`: Token Ring application framework
- `@tokenring-ai/chat`: Chat functionality
- `@tokenring-ai/filesystem`: Abstract filesystem interfaces
- `@tokenring-ai/agent`: Agent framework
- `chokidar`: File system watching
- `execa`: Shell command execution
- `fs-extra`: File system utilities
- `glob`: Glob pattern matching
- `glob-gitignore`: Git ignore pattern support
- `zod`: Runtime type validation

## License

MIT License - see [LICENSE](./LICENSE) file for details.
