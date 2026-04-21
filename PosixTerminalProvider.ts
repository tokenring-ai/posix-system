import { setTimeout as delay } from "node:timers/promises";
import type TokenRingApp from "@tokenring-ai/app";
import type { TerminalService } from "@tokenring-ai/terminal";
import type {
  ExecuteCommandOptions,
  ExecuteCommandResult,
  InteractiveTerminalOutput,
  InteractiveTerminalProvider,
  OutputWaitOptions,
  SessionStatus,
  TerminalIsolationLevel,
} from "@tokenring-ai/terminal/TerminalProvider";
import formatLogMessages from "@tokenring-ai/utility/string/formatLogMessage";
import * as pty from "bun-pty";
import { ExecaError, execa, execaSync } from "execa";
import type { PosixTerminalProviderOptions } from "./schema.ts";

interface InteractiveTerminalSession {
  id: string;
  process: pty.IPty;
  outputBuffer: string;
  lastReadPosition: number;
  startTime: number;
  lastOutputTime: number;
  exitCode?: number | undefined;
}

export default class PosixTerminalProvider implements InteractiveTerminalProvider {
  readonly isInteractive = true;
  readonly name = "PosixTerminalProvider";
  description = "Provides shell command execution on local system";

  private sessions = new Map<string, InteractiveTerminalSession>();
  private nextId = 1;
  supportedIsolationLevels: TerminalIsolationLevel[] = ["none"];

  displayName: string;
  private readonly sandboxProvider: "none" | "bubblewrap" = "none";

  constructor(
    readonly app: TokenRingApp,
    readonly terminalService: TerminalService,
    readonly options: PosixTerminalProviderOptions,
  ) {
    if (options.sandboxProvider === "bubblewrap") {
      try {
        execaSync("which", ["bwrap"]);
        this.supportedIsolationLevels.push("sandbox");
        this.sandboxProvider = "bubblewrap";
      } catch (err: unknown) {
        throw new Error("bubblewrap was set as the sandbox provider, but is not installed", { cause: err });
      }
    }
    if (options.sandboxProvider === "auto") {
      try {
        execaSync("which", ["bwrap"]);
        this.supportedIsolationLevels.push("sandbox");
        this.sandboxProvider = "bubblewrap";
      } catch {}
    }

    this.displayName = `PosixTerminalProvider (sandboxProvider: ${this.sandboxProvider})`;
  }

  async executeCommand(command: string, args: string[], options: ExecuteCommandOptions): Promise<ExecuteCommandResult> {
    const { timeoutSeconds, workingDirectory: cwd } = options;
    const wrapped = this.wrapWithIsolation(command, args, options);

    try {
      const result = await execa(wrapped.command, wrapped.args, {
        cwd,
        env: process.env,
        timeout: timeoutSeconds * 1000,
        maxBuffer: 1024 * 1024,
        stdin: "ignore",
        all: true,
      });

      return {
        status: "success",
        output: result.all?.trim() ?? "",
        exitCode: 0,
      };
    } catch (err: any) {
      if (err instanceof ExecaError) {
        if (err.timedOut) {
          return {
            status: "timeout",
          };
        } else if (err.exitCode !== undefined) {
          return {
            status: "badExitCode",
            output: err.all ?? "",
            exitCode: err.exitCode,
          };
        }
      }
      return {
        status: "unknownError",
        error: formatLogMessages([err as Error]),
      };
    }
  }

  async runScript(script: string, options: ExecuteCommandOptions): Promise<ExecuteCommandResult> {
    const { timeoutSeconds, workingDirectory: cwd } = options;
    const shell = process.env.SHELL || "/bin/bash";
    const wrapped = this.wrapWithIsolation(shell, ["-c", script], options);

    this.app.serviceOutput(this.terminalService, "[runScript]", "spawning shell:", wrapped.command, " ", wrapped.args.join(" "), "in:", cwd);

    try {
      const result = await execa(wrapped.command, wrapped.args, {
        cwd,
        env: {
          ...process.env,
          TERM: "dumb",
          NO_COLOR: "1",
        },
        timeout: timeoutSeconds * 1000,
        maxBuffer: 1024 * 1024,
        stdin: "ignore",
        all: true,
      });

      return {
        status: "success",
        output: result.all?.trim() ?? "",
        exitCode: 0,
      };
    } catch (err: any) {
      if (err instanceof ExecaError) {
        if (err.timedOut) {
          return {
            status: "timeout",
          };
        } else if (err.exitCode !== undefined) {
          return {
            status: "badExitCode",
            output: err.all ?? "",
            exitCode: err.exitCode,
          };
        }
      }
      return {
        status: "unknownError",
        error: formatLogMessages([err as Error]),
      };
    }
  }

  async startInteractiveSession(options: ExecuteCommandOptions): Promise<string> {
    const id = `term-${this.nextId++}`;
    const cwd = options.workingDirectory;

    const shell = process.env.SHELL || "/bin/bash";
    const wrapped = this.wrapWithIsolation(shell, [], options);

    this.app.serviceOutput(
      this.terminalService,
      "[startInteractiveSession]",
      id,
      "spawning shell:",
      wrapped.command,
      "args: ",
      wrapped.args.join(" "),
      "in:",
      cwd,
    );

    const ptyProcess = pty.spawn(wrapped.command, wrapped.args, {
      name: "dumb",
      cols: 80,
      rows: 24,
      cwd,
      env: {
        ...process.env,
        TERM: "dumb",
        NO_COLOR: "1",
      },
    });

    this.app.serviceOutput(this.terminalService, "[startInteractiveSession]", id, "PTY spawned, pid:", ptyProcess.pid);

    const session: InteractiveTerminalSession = {
      id,
      process: ptyProcess,
      outputBuffer: "",
      lastReadPosition: 0,
      startTime: Date.now(),
      lastOutputTime: Date.now(),
    };

    ptyProcess.onData(data => {
      this.app.serviceOutput(this.terminalService, "[PTY onData]", id, "received:", data.length, "bytes");
      session.outputBuffer += data;
      session.lastOutputTime = Date.now();
      this.app.serviceOutput(this.terminalService, "[PTY onData]", id, "buffer now:", session.outputBuffer.length, "bytes");
    });

    ptyProcess.onExit(({ exitCode }) => {
      this.app.serviceOutput(this.terminalService, "[PTY onExit]", id, "exitCode:", exitCode);
      session.exitCode = exitCode;
    });

    this.sessions.set(id, session);

    // Wait briefly for initial prompt to appear
    await delay(100);

    this.app.serviceOutput(this.terminalService, "[startInteractiveSession]", id, "returning, buffer length:", session.outputBuffer.length);
    return id;
  }

  sendInput(sessionId: string, input: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    this.app.serviceOutput(this.terminalService, "[sendInput]", sessionId, "writing:", input);
    session.process.write(`${input}\n`);
  }

  collectOutput(sessionId: string, fromPosition: number, _waitOptions: OutputWaitOptions): InteractiveTerminalOutput {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    this.app.serviceOutput(this.terminalService, "[collectOutput]", sessionId, "from:", fromPosition, "buffer length:", session.outputBuffer.length);
    const output = session.outputBuffer.substring(fromPosition);
    const newPosition = session.outputBuffer.length;
    const isComplete = session.exitCode !== undefined;

    this.app.serviceOutput(this.terminalService, "[collectOutput]", sessionId, "output length:", output.length, "new position:", newPosition);
    return {
      output,
      newPosition,
      isComplete,
      exitCode: session.exitCode,
    };
  }

  terminateSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.app.serviceOutput(this.terminalService, "[terminateSession]", sessionId, "killing process");
    session.process.kill();
    this.sessions.delete(sessionId);
  }

  getSessionStatus(sessionId: string): SessionStatus | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      id: session.id,
      running: session.exitCode === undefined,
      startTime: session.startTime,
      outputLength: session.outputBuffer.length,
      exitCode: session.exitCode,
    };
  }

  private wrapWithIsolation(command: string, args: string[], options: ExecuteCommandOptions): { command: string; args: string[] } {
    const isolationLevel = options.isolation;
    if (isolationLevel === "none") {
      return { command: command, args };
    }

    const cwd = options.workingDirectory;

    const homeDir = process.env.HOME || "/home/" + process.env.USER;
    const bwrapArgs = [
      "--ro-bind",
      "/etc",
      "/etc",
      "--ro-bind",
      "/usr",
      "/usr",
      "--ro-bind",
      "/lib",
      "/lib",
      "--ro-bind",
      "/lib64",
      "/lib64",
      "--ro-bind",
      "/bin",
      "/bin",
      "--ro-bind",
      "/sbin",
      "/sbin",
      "--ro-bind",
      "/etc",
      "/etc",
      "--ro-bind",
      homeDir,
      homeDir,
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--tmpfs",
      "/tmp",
      "--bind",
      cwd,
      cwd,
      "--chdir",
      cwd,
      "--unshare-all",
      "--share-net",
      "--die-with-parent",
      command,
      ...args,
    ];

    return { command: "bwrap", args: bwrapArgs };
  }
}
