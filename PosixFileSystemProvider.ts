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
import chokidar, { type FSWatcher } from "chokidar";
import fs from "fs-extra";
import type { PosixFileSystemProviderOptions } from "./schema.ts";

export default class PosixFileSystemProvider implements FileSystemProvider {
  readonly name = "LocalFilesystemProvider";
  description = "Provides access to the local filesystem";

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
      } catch (error: any) {
        if (error.code === "ENOENT") {
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

  async watch(dir: string, { ignoreFilter, pollInterval = 1000, stabilityThreshold = 2000 }: WatchOptions): Promise<FSWatcher> {
    if (!(await fs.pathExists(dir))) {
      throw new Error(`Directory ${dir} does not exist`);
    }

    return chokidar.watch(dir, {
      ignored: (file: string) => {
        try {
          return ignoreFilter(file);
        } catch {
          return true;
        }
      },
      awaitWriteFinish: {
        stabilityThreshold,
        pollInterval,
      },
    });
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

    const filesToSearch = ignoreFilter ? allFiles.filter(file => !ignoreFilter(file)) : allFiles;

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
          const line = lines[lineNum];

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
