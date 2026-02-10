import TokenRingApp from "@tokenring-ai/app";
import {
  type ExecuteCommandOptions,
  type ExecuteCommandResult,
  type InteractiveTerminalOutput,
  type OutputWaitOptions,
  type SessionStatus,
  type TerminalIsolationLevel,
  type TerminalProvider,
} from "@tokenring-ai/terminal/TerminalProvider";
import formatLogMessages from "@tokenring-ai/utility/string/formatLogMessage";
import * as pty from 'bun-pty';
import {execa, ExecaError, execaSync} from "execa";
import fs from "fs-extra";
import path from "node:path";
import {type LocalTerminalProviderOptions} from "./schema.ts";

interface InteractiveTerminalSession {
  id: string;
  process: pty.IPty;
  outputBuffer: string;
  lastReadPosition: number;
  startTime: number;
  lastOutputTime: number;
  exitCode?: number;
}

export default class PosixTerminalProvider implements TerminalProvider {
  readonly name = "PosixTerminalProvider";
  description = "Provides shell command execution on local system";

  private sessions = new Map<string, InteractiveTerminalSession>();
  private nextId = 1;
  private readonly isolationLevel: 'none' | 'bubblewrap';

  constructor(readonly app: TokenRingApp, readonly options: LocalTerminalProviderOptions) {
    if (!fs.existsSync(options.workingDirectory)) {
      throw new Error(`Root directory ${options.workingDirectory} does not exist`);
    }

    this.isolationLevel = this.resolveIsolation();

    app.serviceOutput(`Using isolation level: ${this.isolationLevel}`)
  }

  private resolveIsolation(): 'none' | 'bubblewrap' {
    if (this.options.isolation === 'none') return 'none';
    if (this.options.isolation === 'bubblewrap') return 'bubblewrap';
    
    // auto mode: check if bubblewrap exists
    try {
      execaSync('which', ['bwrap']);
      return 'bubblewrap';
    } catch {
      return 'none';
    }
  }

  async executeCommand(
    command: string,
    args: string[],
    options: ExecuteCommandOptions,
  ): Promise<ExecuteCommandResult> {
    const {timeoutSeconds, env = {}, workingDirectory = "./"} = options;
    const cwd = path.resolve(this.options.workingDirectory, workingDirectory);
    const wrapped = this.wrapWithBubblewrap(command, args, cwd);

    try {
      const result = await execa(wrapped.command, wrapped.args, {
        cwd,
        env: {...process.env, ...env},
        timeout: timeoutSeconds * 1000,
        maxBuffer: 1024 * 1024,
        stdin: "ignore",
        all: true,
      });

      return {
        status: "success",
        output: result.all?.trim() ?? "",
      };
    } catch (err: any) {
      if (err instanceof ExecaError) {
        if (err.timedOut) {
          return {
            status: "timeout",
          }
        } else if (err.exitCode !== undefined) {
          return {
            status: "badExitCode",
            output: err.all ?? "",
            exitCode: err.exitCode,
          }
        }
      }
      return {
        status: "unknownError",
        error: formatLogMessages([err as Error])
      };
    }
  }

  async runScript(
    script: string,
    options: ExecuteCommandOptions,
  ): Promise<ExecuteCommandResult> {
    const {timeoutSeconds, env = {}, workingDirectory = "./"} = options;
    const cwd = path.resolve(this.options.workingDirectory, workingDirectory);
    const shell = process.env.SHELL || '/bin/bash';
    const wrapped = this.wrapWithBubblewrap(shell, ["-c", script], cwd);

    this.app.serviceOutput('[runScript]', 'spawning shell:', wrapped.command, ' ', wrapped.args.join(' '), 'in:', cwd);

    try {
      const result = await execa(wrapped.command, wrapped.args, {
        cwd,
        env: {
          ...process.env,
          TERM: 'dumb',
          NO_COLOR: '1',
          ...env
        },
        timeout: timeoutSeconds * 1000,
        maxBuffer: 1024 * 1024,
        stdin: "ignore",
        all: true,
      });

      return {
        status: "success",
        output: result.all?.trim() ?? "",
      };
    } catch (err: any) {
      if (err instanceof ExecaError) {
        if (err.timedOut) {
          return {
            status: "timeout",
          }
        } else if (err.exitCode !== undefined) {
          return {
            status: "badExitCode",
            output: err.all ?? "",
            exitCode: err.exitCode,
          }
        }
      }
      return {
        status: "unknownError",
        error: formatLogMessages([err as Error])
      };
    }
  }

  private wrapWithBubblewrap(command: string, args: string[], cwd: string): {command: string, args: string[]} {
    if (this.isolationLevel !== 'bubblewrap') {
      return {command, args};
    }

    const bwrapArgs = [
      '--ro-bind', '/usr', '/usr',
      '--ro-bind', '/lib', '/lib',
      '--ro-bind', '/lib64', '/lib64',
      '--ro-bind', '/bin', '/bin',
      '--ro-bind', '/sbin', '/sbin',
      '--ro-bind', '/etc', '/etc',
      '--proc', '/proc',
      '--dev', '/dev',
      '--tmpfs', '/tmp',
      '--bind', cwd, cwd,
      '--chdir', cwd,
      '--unshare-all',
      '--share-net',
      '--die-with-parent',
      command,
      ...args,
    ];

    return {command: 'bwrap', args: bwrapArgs};
  }

  async startInteractiveSession(options: ExecuteCommandOptions): Promise<string> {
    const id = `term-${this.nextId++}`;
    const cwd = path.resolve(this.options.workingDirectory, options.workingDirectory || "./");

    const shell = process.env.SHELL || '/bin/bash';
    const wrapped = this.wrapWithBubblewrap(shell, [], cwd);

    this.app.serviceOutput('[startInteractiveSession]', id, 'spawning shell:', wrapped.command, 'args: ', wrapped.args.join(' '), 'in:', cwd);
    
    const ptyProcess = pty.spawn(wrapped.command, wrapped.args, {
      name: 'dumb',
      cols: 80,
      rows: 24,
      cwd,
      env: {
        ...process.env,
        ...options.env,
        TERM: 'dumb',
        NO_COLOR: '1'
      } as any,
    });

    this.app.serviceOutput('[startInteractiveSession]', id, 'PTY spawned, pid:', ptyProcess.pid);

    const session: InteractiveTerminalSession = {
      id,
      process: ptyProcess,
      outputBuffer: '',
      lastReadPosition: 0,
      startTime: Date.now(),
      lastOutputTime: Date.now(),
    };

    ptyProcess.onData((data) => {
      this.app.serviceOutput('[PTY onData]', id, 'received:', data.length, 'bytes');
      session.outputBuffer += data;
      session.lastOutputTime = Date.now();
      this.app.serviceOutput('[PTY onData]', id, 'buffer now:', session.outputBuffer.length, 'bytes');
    });

    ptyProcess.onExit(({exitCode}) => {
      this.app.serviceOutput('[PTY onExit]', id, 'exitCode:', exitCode);
      session.exitCode = exitCode;
    });

    this.sessions.set(id, session);
    
    // Wait briefly for initial prompt to appear
    await new Promise(resolve => setTimeout(resolve, 100));
    
    this.app.serviceOutput('[startInteractiveSession]', id, 'returning, buffer length:', session.outputBuffer.length);
    return id;
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    this.app.serviceOutput('[sendInput]', sessionId, 'writing:', input);
    session.process.write(`${input}\n`);
  }

  async collectOutput(
    sessionId: string,
    fromPosition: number,
    waitOptions: OutputWaitOptions
  ): Promise<InteractiveTerminalOutput> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    this.app.serviceOutput('[collectOutput]', sessionId, 'from:', fromPosition, 'buffer length:', session.outputBuffer.length);
    const output = session.outputBuffer.substring(fromPosition);
    const newPosition = session.outputBuffer.length;
    const isComplete = session.exitCode !== undefined;

    this.app.serviceOutput('[collectOutput]', sessionId, 'output length:', output.length, 'new position:', newPosition);
    return {
      output,
      newPosition,
      isComplete,
      exitCode: session.exitCode,
    };
  }

  async terminateSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.app.serviceOutput('[terminateSession]', sessionId, 'killing process');
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

  getIsolationLevel(): TerminalIsolationLevel {
    return this.isolationLevel === 'bubblewrap' ? 'sandbox' : 'none';
  }
}
