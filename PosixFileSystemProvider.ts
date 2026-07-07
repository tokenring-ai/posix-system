import { EventEmitter } from "node:events";
import { type FSWatcher as NodeFSWatcher, watch as watchFileSystem } from "node:fs";
import path from "node:path";
import type {
  DirectoryTreeOptions,
  FileSystemProvider,
  GlobOptions,
  GrepOptions,
  GrepResult,
  StatLike,
  WatchOptions,
} from "@tokenring-ai/filesystem/FileSystemProvider";
import { arrayableToArray } from "@tokenring-ai/utility/array/arrayable";
import { Glob } from "bun";
import fs from "fs-extra";
import type { PosixFileSystemProviderOptions } from "./schema.ts";

type WatchEvent = "add" | "change";
type PosixWatchOptions = {
  ignoreFilter: (path: string) => boolean;
  pollInterval: number;
  stabilityThreshold: number;
};

class PosixFileSystemWatcher extends EventEmitter {
  private readonly watcher: NodeFSWatcher;
  private readonly pendingEvents = new Map<string, { event: WatchEvent; timeout: NodeJS.Timeout }>();
  private closed = false;

  constructor(
    private readonly dir: string,
    private readonly options: PosixWatchOptions,
  ) {
    super();
    this.watcher = watchFileSystem(dir, { recursive: true }, (eventType, filename) => {
      void this.handleFileSystemEvent(eventType, filename);
    });
    this.watcher.on("error", error => this.emit("error", error));

    setTimeout(() => {
      void this.emitInitialFiles(dir);
    });
  }

  close(): void {
    this.closed = true;
    this.watcher.close();
    for (const { timeout } of this.pendingEvents.values()) {
      clearTimeout(timeout);
    }
    this.pendingEvents.clear();
  }

  private async handleFileSystemEvent(eventType: string, filename: string | Buffer | null): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- this.closed can be mutated asynchronously by close(); TS narrowing doesn't account for this across await/loop iterations
    if (this.closed || !filename) return;

    const filePath = this.resolveFilePath(filename);
    if (this.isIgnored(filePath)) return;

    if (eventType === "change") {
      this.scheduleStableEvent("change", filePath);
      return;
    }

    try {
      const stats = await fs.stat(filePath);
      if (stats.isFile()) {
        this.scheduleStableEvent("add", filePath);
      }
    } catch (error) {
      const { code } = error as { code?: string };
      if (code === "ENOENT") {
        this.clearPendingEvent(filePath);
        this.emit("unlink", filePath);
      } else {
        this.emit("error", error);
      }
    }
  }

  private async emitInitialFiles(dir: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- this.closed can be mutated asynchronously by close(); TS narrowing doesn't account for this across await/loop iterations
    if (this.closed) return;

    let entries: fs.Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- this.closed can be mutated asynchronously by close(); TS narrowing doesn't account for this across await/loop iterations
      if (!this.closed) this.emit("error", error);
      return;
    }

    for (const entry of entries) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- this.closed can be mutated asynchronously by close(); TS narrowing doesn't account for this across await/loop iterations
      if (this.closed) return;

      const entryPath = path.join(dir, entry.name);
      if (this.isIgnored(entryPath)) continue;

      if (entry.isDirectory()) {
        await this.emitInitialFiles(entryPath);
      } else {
        this.scheduleStableEvent("add", entryPath);
      }
    }
  }

  private resolveFilePath(filename: string | Buffer): string {
    const filePath = filename.toString();
    return path.isAbsolute(filePath) ? filePath : path.join(this.dir, filePath);
  }

  private scheduleStableEvent(event: WatchEvent, filePath: string): void {
    const eventToEmit = this.eventWithCreationPrecedence(this.pendingEvents.get(filePath)?.event, event);
    this.clearPendingEvent(filePath);

    let lastSize = -1;
    let lastModified = -1;
    let stableSince = Date.now();

    const check = async () => {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- this.closed can be mutated asynchronously by close(); TS narrowing doesn't account for this across await/loop iterations
      if (this.closed) return;

      try {
        if (this.isIgnored(filePath)) {
          this.pendingEvents.delete(filePath);
          return;
        }

        const stats = await fs.stat(filePath);
        if (!stats.isFile()) {
          this.pendingEvents.delete(filePath);
          return;
        }

        const modified = stats.mtimeMs;
        if (stats.size !== lastSize || modified !== lastModified) {
          lastSize = stats.size;
          lastModified = modified;
          stableSince = Date.now();
        }

        if (Date.now() - stableSince >= this.options.stabilityThreshold) {
          this.pendingEvents.delete(filePath);
          this.emit(eventToEmit, filePath);
          return;
        }

        this.pendingEvents.set(filePath, {
          event: eventToEmit,
          timeout: setTimeout(check, this.options.pollInterval),
        });
      } catch (error) {
        this.pendingEvents.delete(filePath);
        const { code } = error as { code?: string };
        if (code === "ENOENT") {
          this.emit("unlink", filePath);
        } else {
          this.emit("error", error);
        }
      }
    };

    this.pendingEvents.set(filePath, {
      event: eventToEmit,
      timeout: setTimeout(check, this.options.pollInterval),
    });
  }

  private eventWithCreationPrecedence(pendingEvent: WatchEvent | undefined, event: WatchEvent): WatchEvent {
    return pendingEvent === "add" || event === "add" ? "add" : "change";
  }

  private clearPendingEvent(filePath: string): void {
    const pendingEvent = this.pendingEvents.get(filePath);
    if (pendingEvent) {
      clearTimeout(pendingEvent.timeout);
      this.pendingEvents.delete(filePath);
    }
  }

  private isIgnored(filePath: string): boolean {
    try {
      return this.options.ignoreFilter(filePath);
    } catch {
      return true;
    }
  }
}

export default class PosixFileSystemProvider implements FileSystemProvider {
  readonly name = "PosixFilesystemProvider";
  description = "Provides access to a local, posix style filesystem";

  constructor(readonly options: PosixFileSystemProviderOptions = {}) {}

  async writeFile(filePath: string, content: string | Buffer): Promise<boolean> {
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, content);
    return true;
  }

  async appendFile(filePath: string, finalContent: string | Buffer): Promise<boolean> {
    await fs.ensureDir(path.dirname(filePath));
    await fs.appendFile(filePath, finalContent);
    return true;
  }

  async deleteFile(filePath: string): Promise<boolean> {
    if (!(await fs.pathExists(filePath))) {
      throw new Error(`File ${filePath} does not exist`);
    }
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      throw new Error(`Path ${filePath} is not a file`);
    }
    await fs.remove(filePath);
    return true;
  }

  async readFile(filePath: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  async rename(oldPath: string, newPath: string): Promise<boolean> {
    if (!(await fs.pathExists(oldPath))) {
      throw new Error(`Path ${oldPath} does not exist`);
    }
    if (await fs.pathExists(newPath)) {
      throw new Error(`Path ${newPath} already exists`);
    }
    await fs.ensureDir(path.dirname(newPath));
    await fs.rename(oldPath, newPath);
    return true;
  }

  exists(filePath: string): Promise<boolean> {
    return fs.pathExists(filePath);
  }

  async stat(filePath: string): Promise<StatLike> {
    try {
      const stats = await fs.stat(filePath);
      return {
        exists: true,
        path: filePath,
        absolutePath: filePath,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        isSymbolicLink: stats.isSymbolicLink(),
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        accessed: stats.atime,
      };
    } catch {
      return {
        exists: false,
        path: filePath,
      };
    }
  }

  async createDirectory(dirPath: string, options: { recursive?: boolean | undefined } = {}): Promise<boolean> {
    const { recursive = false } = options;

    if (await fs.pathExists(dirPath)) {
      const stats = await fs.stat(dirPath);
      if (stats.isDirectory()) {
        return true;
      } else {
        throw new Error(`Path ${dirPath} exists but is not a directory`);
      }
    }

    if (recursive) {
      await fs.ensureDir(dirPath);
    } else {
      try {
        await fs.mkdir(dirPath);
      } catch (error) {
        const { code } = error as { code?: string };
        if (code === "ENOENT") {
          throw new Error(`Parent directory for ${dirPath} does not exist`);
        }
        throw error;
      }
    }

    return true;
  }

  async copy(source: string, destination: string, options: { overwrite?: boolean | undefined } = {}): Promise<boolean> {
    const { overwrite = false } = options;

    if (!(await fs.pathExists(source))) {
      throw new Error(`Source path ${source} does not exist`);
    }

    if (!overwrite && (await fs.pathExists(destination))) {
      throw new Error(`Destination path ${destination} already exists`);
    }

    await fs.copy(source, destination, { overwrite });
    return true;
  }

  async glob(pattern: string, { ignoreFilter, includeDirectories = false }: GlobOptions): Promise<string[]> {
    const glob = new Glob(pattern);

    const files = await Array.fromAsync(glob.scan({ dot: true, onlyFiles: !includeDirectories, absolute: true }));

    return files.filter(file => !ignoreFilter(file));
  }

  async watch(dir: string, { ignoreFilter, pollInterval = 1000, stabilityThreshold = 2000 }: WatchOptions): Promise<PosixFileSystemWatcher> {
    if (!(await fs.pathExists(dir))) {
      throw new Error(`Directory ${dir} does not exist`);
    }

    return new PosixFileSystemWatcher(dir, { ignoreFilter, pollInterval, stabilityThreshold });
  }

  async grep(searchString: string | string[], options: GrepOptions): Promise<GrepResult[]> {
    const { ignoreFilter, includeContent = {}, cwd = process.cwd() } = options;
    const { linesBefore = 0, linesAfter = 0 } = includeContent;
    const searchStrings = arrayableToArray(searchString);

    if (searchStrings.every(item => !item)) {
      throw new Error("Search string is required");
    }

    const allFiles: string[] = [];
    for await (const file of this.getDirectoryTree(cwd, { ignoreFilter })) {
      allFiles.push(file);
    }

    const filesToSearch = allFiles.filter(file => !ignoreFilter(file));

    const results: Array<{
      file: string;
      line: number;
      match: string;
      content: string | null;
    }> = [];

    for (const file of filesToSearch) {
      try {
        const content = await this.readFile(file);
        if (!content) continue;
        const lines = content.toString("utf-8").split("\n");

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          const line = lines[lineNum]!;

          if (searchStrings.some(value => value && line.includes(value))) {
            const startLine = Math.max(0, lineNum - linesBefore);
            const endLine = Math.min(lines.length - 1, lineNum + linesAfter);

            let contextContent: string | null = null;
            if (linesBefore > 0 || linesAfter > 0) {
              contextContent = lines.slice(startLine, endLine + 1).join("\n");
            }

            results.push({
              file,
              line: lineNum + 1,
              match: line,
              content: contextContent,
            });
          }
        }
      } catch {
        // Ignore files that cannot be read due to permissions or transient errors
      }
    }

    return results;
  }

  async *getDirectoryTree(dir: string, { ignoreFilter, recursive = true }: DirectoryTreeOptions): AsyncGenerator<string> {
    const items = await fs.readdir(dir, { withFileTypes: true });

    for (const item of items) {
      const itemPath = path.join(dir, item.name);
      if (ignoreFilter(itemPath)) continue;

      if (item.isDirectory()) {
        yield `${itemPath}/`;
        if (recursive) {
          yield* this.getDirectoryTree(itemPath, { ignoreFilter });
        }
      } else {
        yield itemPath;
      }
    }
  }
}
