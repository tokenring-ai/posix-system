import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import path from "node:path";
import fs from "fs-extra";
import PosixFileSystemProvider from "../PosixFileSystemProvider";

type TestWatcher = {
  on(event: string, listener: (filePath: string) => void): TestWatcher;
  close(): void;
};

function waitForWatchEvent(watcher: TestWatcher, event: string, expectedPath: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${event} on ${expectedPath}`)), timeoutMs);

    watcher.on(event, (filePath: string) => {
      if (filePath !== expectedPath) return;
      clearTimeout(timeout);
      resolve(filePath);
    });
  });
}

/**
 * Integration tests for PosixFileSystemProvider that test the complete flow
 * including file operations and edge cases.
 */
describe("PosixFileSystemProvider Integration Tests", () => {
  let testDir!: string;
  let service!: PosixFileSystemProvider;

  beforeEach(() => {
    // Unique dir per test avoids cross-test races under full-suite load.
    testDir = fs.mkdtempSync(path.join("/tmp", "posix-filesystem-test-"));
    service = new PosixFileSystemProvider();
  });

  afterEach(() => {
    // Clean up the temporary directory
    if (testDir && fs.existsSync(testDir)) {
      fs.removeSync(testDir);
    }
  });

  describe("File Operations", () => {
    it("should create, read, and delete a file", async () => {
      const filePath = "test.txt";
      const absoluteFilePath = path.resolve(testDir, filePath);
      const content = "Hello, World!";

      // Create a file
      await service.writeFile(absoluteFilePath, content);
      expect(await service.exists(absoluteFilePath)).toBe(true);

      // Read the file
      const readContent = (await service.readFile(absoluteFilePath))?.toString("utf8");
      expect(readContent).toBe(content);

      // Get file stats
      const stats = await service.stat(absoluteFilePath);
      expect(stats.exists).toBe(true);
      if (stats.exists) {
        expect(stats.isFile).toBe(true);
        expect(stats.size).toBe(content.length);
      }

      // Delete the file
      await service.deleteFile(absoluteFilePath);
      expect(await service.exists(absoluteFilePath)).toBe(false);
    });

    it("should handle directory operations", async () => {
      const dirPath = "test-dir";
      const absoluteDirPath = path.resolve(testDir, dirPath);

      // Create a directory
      await service.createDirectory(absoluteDirPath);
      expect(await service.exists(absoluteDirPath)).toBe(true);

      // Get directory stats
      const stats = await service.stat(absoluteDirPath);
      expect(stats.exists).toBe(true);
      if (stats.exists) {
        expect(stats.isDirectory).toBe(true);
      }

      // Create a file in the directory
      const filePath = path.join(absoluteDirPath, "file.txt");
      await service.writeFile(filePath, "test content");

      // Rename the file
      const newPath = path.join(absoluteDirPath, "renamed.txt");
      await service.rename(filePath, newPath);
      expect(await service.exists(filePath)).toBe(false);
      expect(await service.exists(newPath)).toBe(true);
    });

    it("should copy files and directories", async () => {
      const sourceFile = "source.txt";
      const absoluteSourceFile = path.resolve(testDir, sourceFile);
      const sourceContent = "source content";

      // Create source file
      await service.writeFile(absoluteSourceFile, sourceContent);

      // Copy the file
      const destFile = path.resolve(testDir, "dest.txt");
      await service.copy(absoluteSourceFile, destFile);

      expect(await service.exists(destFile)).toBe(true);
      const content = (await service.readFile(destFile))?.toString("utf8");
      expect(content).toBe(sourceContent);
    });
  });

  describe("Error Handling", () => {
    it("should throw error for non-existent file operations", async () => {
      const nonExistentFile = path.resolve(testDir, "non-existent.txt");

      expect(service.readFile(nonExistentFile)).resolves.toBeNull();
      expect(service.deleteFile(nonExistentFile)).rejects.toThrow();
    });
  });

  describe("Glob and Search Operations", () => {
    it("should find files matching glob patterns", async () => {
      // Create test files
      await service.writeFile(path.resolve(testDir, "file1.txt"), "content1");
      await service.writeFile(path.resolve(testDir, "file2.txt"), "content2");
      await service.writeFile(path.resolve(testDir, "other.js"), "javascript");

      // Find txt files
      const txtFiles = await service.glob(path.resolve(testDir, "*.txt"), { ignoreFilter: () => false });
      expect(txtFiles).toContain(path.resolve(testDir, "file1.txt"));
      expect(txtFiles).toContain(path.resolve(testDir, "file2.txt"));
      expect(txtFiles).toHaveLength(2);
    });
  });

  describe("Directory delete", () => {
    it("recursively deletes a directory and its contents", async () => {
      const dir = path.resolve(testDir, "build");
      await service.writeFile(path.join(dir, "a.txt"), "a");
      await service.writeFile(path.join(dir, "nested", "b.txt"), "b");

      expect(await service.deleteDirectory(dir)).toBe(true);
      expect(await service.exists(dir)).toBe(false);
      expect(await service.exists(testDir)).toBe(true);
    });

    it("refuses files, symlinks, missing paths and the filesystem root", async () => {
      const file = path.resolve(testDir, "file.txt");
      await service.writeFile(file, "x");
      const target = path.resolve(testDir, "real");
      await service.writeFile(path.join(target, "keep.txt"), "keep");
      const link = path.resolve(testDir, "link");
      await fs.symlink(target, link);

      await expect(service.deleteDirectory(file)).rejects.toThrow(/not a directory/);
      await expect(service.deleteDirectory(link)).rejects.toThrow(/symbolic link/);
      await expect(service.deleteDirectory(path.resolve(testDir, "missing"))).rejects.toThrow(/does not exist/);
      await expect(service.deleteDirectory("/")).rejects.toThrow(/root/);
      expect(await service.exists(path.join(target, "keep.txt"))).toBe(true);
    });
  });

  describe("Grep limits", () => {
    it("stops at maxResults and supports case-insensitive matching", async () => {
      await service.writeFile(path.resolve(testDir, "a.txt"), "Needle one\nneedle two\nnothing\nNEEDLE three\n");
      const all = await service.grep("needle", { cwd: testDir, ignoreFilter: () => false, ignoreCase: true });
      expect(all.map(result => result.line)).toEqual([1, 2, 4]);
      const limited = await service.grep("needle", { cwd: testDir, ignoreFilter: () => false, ignoreCase: true, maxResults: 2 });
      expect(limited.map(result => result.line)).toEqual([1, 2]);
      const caseSensitive = await service.grep("needle", { cwd: testDir, ignoreFilter: () => false });
      expect(caseSensitive.map(result => result.line)).toEqual([2]);
    });
  });

  describe("Watch Operations", () => {
    it("should detect files created inside directories added after watching starts", async () => {
      const watcher = await service.watch(testDir, {
        ignoreFilter: () => false,
        pollInterval: 5,
        stabilityThreshold: 10,
      });
      // Allow the native recursive watcher and initial scan to settle.
      await new Promise(resolve => setTimeout(resolve, 50));

      const nestedDir = path.join(testDir, "new-dir");
      const nestedFile = path.join(nestedDir, "file.txt");
      const added = waitForWatchEvent(watcher, "add", nestedFile);

      try {
        await service.createDirectory(nestedDir);
        await service.writeFile(nestedFile, "created after watch started");

        await expect(added).resolves.toBe(nestedFile);
      } finally {
        watcher.close();
      }
    });
  });
});
