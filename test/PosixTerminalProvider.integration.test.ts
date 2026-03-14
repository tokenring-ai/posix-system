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
  service = new PosixTerminalProvider({serviceOutput() {} } as any, {} as any, {isolation: "none"});
 });


 describe("Shell Commands", () => {
  it("should run shell commands", async () => {
   // Simple command test
   const result = await service.runScript("echo hello",{ timeoutSeconds: 5, workingDirectory: testDir});
   expect(result.status).toBe("success");
   if (result.status === "success") {
    expect(result.output).toBe("hello");
   }
  });

  it("should handle command errors gracefully", async () => {
   // Command that should fail
   const result = await service.runScript("false", { timeoutSeconds: 5, workingDirectory: testDir });
   expect(result.status).toBe("badExitCode");
   if (result.status === "badExitCode") {
    expect(result.exitCode).toBe(1);
   }
  });
 });
});
