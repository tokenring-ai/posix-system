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
  service = new PosixFileSystemProvider();
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
   expect(stats.isFile).toBe(true);
   expect(stats.size).toBe(content.length);

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
   expect(stats.isDirectory).toBe(true);

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
   const content = (await service.readFile(destFile))?.toString( "utf8");
   expect(content).toBe(sourceContent);
  });
 });

 describe("Error Handling", () => {
  it("should throw error for non-existent file operations", async () => {
   const nonExistentFile = path.resolve(testDir, "non-existent.txt");

   await expect(service.readFile(nonExistentFile)).resolves.toBeNull();
   await expect(service.deleteFile(nonExistentFile)).rejects.toThrow();
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
});
