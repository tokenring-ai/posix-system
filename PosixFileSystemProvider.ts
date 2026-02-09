import FileSystemProvider, {
  DirectoryTreeOptions,
  GlobOptions,
  GrepOptions,
  GrepResult,
  StatLike,
  WatchOptions
} from "@tokenring-ai/filesystem/FileSystemProvider";
import chokidar, {FSWatcher} from "chokidar";
import fs from "fs-extra";
import {glob} from "glob";
import path from "node:path";
import type {LocalFileSystemProviderOptions} from "./schema.ts";

export default class PosixFileSystemProvider implements FileSystemProvider {
  readonly name = "LocalFilesystemProvider";
  description = "Provides access to the local filesystem";

  constructor(readonly options: LocalFileSystemProviderOptions) {
    if (!fs.existsSync(options.workingDirectory)) {
      throw new Error(`Root directory ${options.workingDirectory} does not exist`);
    }
  }
  relativeOrAbsolutePathToAbsolutePath(p: string): string {
    if (path.isAbsolute(p)) {
      const relativePath = path.relative(this.options.workingDirectory, p);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error(`Path ${p} is outside the root directory`);
      }
      return p;
    } else {
      return path.resolve(this.options.workingDirectory, p);
    }
  }

  relativeOrAbsolutePathToRelativePath(p: string): string {
    return path.relative(this.options.workingDirectory, this.relativeOrAbsolutePathToAbsolutePath(p));
  }

  async writeFile(filePath: string, content: string | Buffer): Promise<boolean> {
    const absolutePath = this.relativeOrAbsolutePathToAbsolutePath(filePath);
    await fs.ensureDir(path.dirname(absolutePath));
    await fs.writeFile(absolutePath, content);
    return true;
  }

  async appendFile(filePath: string, finalContent: string | Buffer): Promise<boolean> {
    const absolutePath = this.relativeOrAbsolutePathToAbsolutePath(filePath);
    await fs.ensureDir(path.dirname(absolutePath));
    await fs.appendFile(absolutePath, finalContent);
    return true;
  }

  async deleteFile(filePath: string): Promise<boolean> {
    const absolutePath = this.relativeOrAbsolutePathToAbsolutePath(filePath);
    if (!(await fs.pathExists(absolutePath))) {
      throw new Error(`File ${filePath} does not exist`);
    }
    const stats = await fs.stat(absolutePath);
    if (!stats.isFile()) {
      throw new Error(`Path ${filePath} is not a file`);
    }
    await fs.remove(absolutePath);
    return true;
  }


  async readFile(filePath: string): Promise<Buffer|null> {
    const absolutePath = this.relativeOrAbsolutePathToAbsolutePath(filePath);
    try {
      return await fs.readFile(absolutePath);
    } catch (error) {
      return null;
    }
  }

  async rename(oldPath: string, newPath: string): Promise<boolean> {
    const absoluteOldPath = this.relativeOrAbsolutePathToAbsolutePath(oldPath);
    const absoluteNewPath = this.relativeOrAbsolutePathToAbsolutePath(newPath);

    if (!(await fs.pathExists(absoluteOldPath))) {
      throw new Error(`Path ${oldPath} does not exist`);
    }
    if (await fs.pathExists(absoluteNewPath)) {
      throw new Error(`Path ${newPath} already exists`);
    }
    await fs.ensureDir(path.dirname(absoluteNewPath));
    await fs.rename(absoluteOldPath, absoluteNewPath);
    return true;
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      const absolutePath = this.relativeOrAbsolutePathToAbsolutePath(filePath);
      return fs.pathExists(absolutePath);
    } catch (_error) {
      return false;
    }
  }

  async stat(filePath: string): Promise<StatLike> {
    const absolutePath = this.relativeOrAbsolutePathToAbsolutePath(filePath);

    try {
      const stats = await fs.stat(absolutePath);
      return {
        exists: true,
        path: filePath,
        absolutePath: absolutePath,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        isSymbolicLink: stats.isSymbolicLink(),
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        accessed: stats.atime,
      };
    } catch (error) {
      return {
        exists: false,
        path: filePath,
      }
    }
  }

  async createDirectory(dirPath: string, options: { recursive?: boolean } = {}): Promise<boolean> {
    const absolutePath = this.relativeOrAbsolutePathToAbsolutePath(dirPath);
    const {recursive = false} = options;

    if (await fs.pathExists(absolutePath)) {
      const stats = await fs.stat(absolutePath);
      if (stats.isDirectory()) {
        return true;
      } else {
        throw new Error(`Path ${dirPath} exists but is not a directory`);
      }
    }

    if (recursive) {
      await fs.ensureDir(absolutePath);
    } else {
      try {
        await fs.mkdir(absolutePath);
      } catch (error: any) {
        if (error.code === "ENOENT") {
          throw new Error(`Parent directory for ${dirPath} does not exist`);
        }
        throw error;
      }
    }

    return true;
  }

  async copy(source: string, destination: string, options: { overwrite?: boolean } = {}): Promise<boolean> {
    const absoluteSource = this.relativeOrAbsolutePathToAbsolutePath(source);
    const absoluteDestination = this.relativeOrAbsolutePathToAbsolutePath(destination);
    const {overwrite = false} = options;

    if (!(await fs.pathExists(absoluteSource))) {
      throw new Error(`Source path ${source} does not exist`);
    }

    if (!overwrite && (await fs.pathExists(absoluteDestination))) {
      throw new Error(`Destination path ${destination} already exists`);
    }

    await fs.copy(absoluteSource, absoluteDestination, {overwrite});
    return true;
  }

  async glob(pattern: string, {ignoreFilter, includeDirectories = false}: GlobOptions): Promise<string[]> {
    try {
      return glob
        .sync(pattern, {
          cwd: this.options.workingDirectory,
          dot: true,
          nodir: !includeDirectories,
          absolute: false,
        })
        .filter((file) => {
          return !ignoreFilter(file);
        });
    } catch (error: any) {
      throw new Error(`Glob operation failed: ${error.message}`);
    }
  }

  async watch(
    dir: string,
    {ignoreFilter, pollInterval = 1000, stabilityThreshold = 2000}: WatchOptions
  ): Promise<FSWatcher> {
    const absolutePath = path.resolve(this.options.workingDirectory, dir);

    if (!(await fs.pathExists(absolutePath))) {
      throw new Error(`Directory ${dir} does not exist`);
    }

    const cwd = path.relative(process.cwd(), this.options.workingDirectory);
    return chokidar.watch("./", {
      ignored: (file: string) => {
        if (file === "." || file === "./") return false;

        if (file.startsWith("./")) {
          file = file.substring(2);
        }

        try {
          return ignoreFilter!(file);
        } catch (_error) {
          return true;
        }
      },
      cwd: cwd,
      awaitWriteFinish: {
        stabilityThreshold,
        pollInterval,
      },
    });
  }

  async grep(
    searchString: string,
    options: GrepOptions
  ): Promise<GrepResult[]> {
    const {ignoreFilter, includeContent = {}} = options;
    const {linesBefore = 0, linesAfter = 0} = includeContent;

    if (!searchString) {
      throw new Error("Search string is required");
    }

    const allFiles: string[] = [];
    for await (const file of this.getDirectoryTree("", {ignoreFilter})) {
      allFiles.push(file);
    }

    const filesToSearch = ignoreFilter ? allFiles.filter((file) => !ignoreFilter(file)) : allFiles;

    const results: Array<{ file: string; line: number; match: string; content: string | null }> = [];

    for (const file of filesToSearch) {
      try {
        const content = await this.readFile(file);
        if (!content) continue;
        const lines = content.toString('utf-8').split("\n");

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          const line = lines[lineNum];

          if (line.includes(searchString)) {
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
      } catch (_error) {
        // Ignore files that cannot be read due to permissions or transient errors
      }
    }

    return results;
  }

  async* getDirectoryTree(
    dir: string,
    {ignoreFilter, recursive = true}: DirectoryTreeOptions
  ): AsyncGenerator<string> {

    const absoluteDir = path.resolve(this.options.workingDirectory, dir);
    const items = await fs.readdir(absoluteDir, {withFileTypes: true});

    for (const item of items) {
      const itemPath = path.join(absoluteDir, item.name);
      const relPath = path.relative(this.options.workingDirectory, itemPath);

      if (ignoreFilter(relPath)) continue;

      if (item.isDirectory()) {
        yield `${relPath}/`;
        if (recursive) {
          yield* this.getDirectoryTree(relPath, {ignoreFilter});
        }
      } else {
        yield relPath;
      }
    }
  }

}
