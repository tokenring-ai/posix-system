import fs from "fs-extra";
import {beforeEach, describe, expect, it} from "vitest";
import PosixTerminalProvider from "../PosixTerminalProvider";

/**
 * Integration tests for LocalFileSystemService that test the complete flow
 * including file operations and edge cases.
 */
describe("PosixTerminalProvider Integration Tests", () => {
 let testDir = "/tmp/posix-terminal-test";
 let service!: PosixTerminalProvider;

 beforeEach(() => {
  fs.ensureDirSync(testDir);
  service = new PosixTerminalProvider({workingDirectory: testDir});
 });


 describe("Shell Commands", () => {
  it("should run shell commands", async () => {
   // Simple command test
   const result = await service.runScript("echo hello",{ timeoutSeconds: 5});
   expect(result.ok).toBe(true);
   expect(result.stdout).toBe("hello");
  });

  it("should handle command errors gracefully", async () => {
   // Command that should fail
   const result = await service.runScript("false", { timeoutSeconds: 5 });
   expect(result.ok).toBe(false);
   expect(result.exitCode).toBe(1);
  });
 });
});
