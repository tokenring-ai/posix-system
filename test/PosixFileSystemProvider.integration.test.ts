import path from "node:path";
import fs from "fs-extra";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import PosixFileSystemProvider from "../PosixFileSystemProvider";

/**
 * Integration tests for PosixFileSystemProvider that test the complete flow
 * including file operations and edge cases.
 */
describe("PosixFileSystemProvider Integration Tests", () => {
  let testDir = "/tmp/posix-filesystem-test";
  let service!: PosixFileSystemProvider;

 beforeEach(() => {
  fs.ensureDirSync(testDir);
  service = new PosixFileSystemProvider({workingDirectory: testDir});
 });

 afterEach(() => {
  // Clean up the temporary directory
  if (fs.existsSync(testDir)) {
   fs.removeSync(testDir);
  }
 });

 describe("File Operations", () => {
  it("should create, read, and delete a file", async () => {
   const filePath = "test.txt";
   const content = "Hello, World!";

   // Create a file
   await service.writeFile(filePath, content);
   expect(await service.exists(filePath)).toBe(true);

   // Read the file
   const readContent = (await service.readFile(filePath))?.toString("utf8");
   expect(readContent).toBe(content);

   // Get file stats
   const stats = await service.stat(filePath);
   expect(stats.isFile).toBe(true);
   expect(stats.size).toBe(content.length);

   // Delete the file
   await service.deleteFile(filePath);
   expect(await service.exists(filePath)).toBe(false);
  });

  it("should handle directory operations", async () => {
   const dirPath = "test-dir";

   // Create a directory
   await service.createDirectory(dirPath);
   expect(await service.exists(dirPath)).toBe(true);

   // Get directory stats
   const stats = await service.stat(dirPath);
   expect(stats.isDirectory).toBe(true);

   // Create a file in the directory
   const filePath = path.join(dirPath, "file.txt");
   await service.writeFile(filePath, "test content");

   // Rename the file
   const newPath = path.join(dirPath, "renamed.txt");
   await service.rename(filePath, newPath);
   expect(await service.exists(filePath)).toBe(false);
   expect(await service.exists(newPath)).toBe(true);
  });

  it("should copy files and directories", async () => {
   const sourceFile = "source.txt";
   const sourceContent = "source content";

   // Create source file
   await service.writeFile(sourceFile, sourceContent);

   // Copy the file
   const destFile = "dest.txt";
   await service.copy(sourceFile, destFile);

   expect(await service.exists(destFile)).toBe(true);
   const content = (await service.readFile(destFile))?.toString( "utf8");
   expect(content).toBe(sourceContent);
  });
 });

 describe("Path Resolution", () => {
  it("should resolve relative and absolute paths correctly", () => {
   const relativePath = "test.txt";
   const absolutePath = path.resolve(testDir, relativePath);

   const resolvedAbsolutePath =
    service.relativeOrAbsolutePathToAbsolutePath(relativePath);
   expect(resolvedAbsolutePath).toBe(absolutePath);

   const resolvedRelativePath =
    service.relativeOrAbsolutePathToRelativePath(absolutePath);
   expect(resolvedRelativePath).toBe(relativePath);
  });
 });

 describe("Error Handling", () => {
  it("should throw error for non-existent file operations", async () => {
   const nonExistentFile = "non-existent.txt";

   await expect(service.readFile(nonExistentFile)).resolves.toBeNull();
   await expect(service.deleteFile(nonExistentFile)).rejects.toThrow();
  });

  it("should throw error for operations outside root directory", () => {
   const outsidePath = "/etc/passwd";

   expect(() =>
    service.relativeOrAbsolutePathToAbsolutePath(outsidePath),
   ).toThrow(/outside the root directory/);
  });
 });

 describe("Glob and Search Operations", () => {
  it("should find files matching glob patterns", async () => {
   // Create test files
   await service.writeFile("file1.txt", "content1");
   await service.writeFile("file2.txt", "content2");
   await service.writeFile("other.js", "javascript");

   // Find txt files
   const txtFiles = await service.glob("*.txt", { ignoreFilter: () => false });
   expect(txtFiles).toContain("file1.txt");
   expect(txtFiles).toContain("file2.txt");
   expect(txtFiles).toHaveLength(2);
  });
 });
});
