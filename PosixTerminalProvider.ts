import {type ExecuteCommandOptions, type ExecuteCommandResult, type TerminalProvider,} from "@tokenring-ai/terminal/TerminalProvider";
import {execa} from "execa";
import fs from "fs-extra";
import path from "node:path";
import {type LocalTerminalProviderOptions} from "./schema.ts";

export default class PosixTerminalProvider implements TerminalProvider {
  name = "LocalTerminalProvider";
  description = "Provides shell command execution on local system";

  constructor(readonly options: LocalTerminalProviderOptions) {
    if (!fs.existsSync(options.workingDirectory)) {
      throw new Error(`Root directory ${options.workingDirectory} does not exist`);
    }
  }

  async executeCommand(
    command: string,
    args: string[],
    options: ExecuteCommandOptions,
  ): Promise<ExecuteCommandResult> {
    const {timeoutSeconds, env = {}, workingDirectory = "./"} = options;
    const cwd = path.resolve(this.options.workingDirectory, workingDirectory);

    try {
      const result = await execa(command, args, {
        cwd,
        env: {...process.env, ...env},
        timeout: timeoutSeconds * 1000,
        maxBuffer: 1024 * 1024,
        stdin: options.input ? [[options.input]] : "ignore",
        all: true,
      });

      return {
        ok: true,
        output: result.all?.trim() ?? "",
        exitCode: result.exitCode ?? 1,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (err: any) {
      return {
        ok: false,
        output: err.all?.trim() ?? "",
        exitCode: typeof err.exitCode === "number" ? err.exitCode : 1,
        stdout: err.stdout?.trim?.() ?? "",
        stderr: err.stderr?.trim?.() ?? "",
        error: err.shortMessage || err.message || err.toString?.() || "Unknown error",
      };
    }
  }

  async runScript(
    script: string,
    options: ExecuteCommandOptions,
  ): Promise<ExecuteCommandResult> {
    const {timeoutSeconds, env = {}, workingDirectory = "./"} = options;
    const cwd = path.resolve(this.options.workingDirectory, workingDirectory);

    try {
      const result = await execa(script, {
        cwd,
        shell: true,
        env: {...process.env, ...env},
        timeout: timeoutSeconds * 1000,
        maxBuffer: 1024 * 1024,
        stdin: options.input ? [[options.input]] : "ignore",
        all: true,
      });

      return {
        ok: true,
        output: result.all?.trim() ?? "",
        exitCode: result.exitCode ?? 1,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (err: any) {
      return {
        ok: false,
        output: err.all?.trim() ?? "",
        exitCode: typeof err.exitCode === "number" ? err.exitCode : 1,
        stdout: err.stdout?.trim?.() ?? "",
        stderr: err.stderr?.trim?.() ?? "",
        error: err.shortMessage || err.message || err.toString?.() || "Unknown error",
      };
    }
  }
}
