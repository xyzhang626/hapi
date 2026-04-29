import { spawn, type Subprocess } from 'bun'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

export interface EmbeddedRunnerOptions {
    /** The hub HTTP/WS URL the runner should connect to (e.g. http://127.0.0.1:3006) */
    apiUrl: string
    /** The CLI API token the runner should use to authenticate */
    cliApiToken: string
    /** Optional override for the cli package directory; defaults to <repo>/cli */
    cliDir?: string
    /** HAPI_HOME override (filesystem location for runner state) */
    hapiHome?: string
    /** If true, log subprocess stdout/stderr to console with [embedded-runner] prefix */
    verbose?: boolean
}

/**
 * Hub-embedded runner subprocess.
 *
 * Forks `cli runner start-sync` as a child process pointing at the local hub.
 * Lifecycle is bound to the parent hub: stop() kills the subprocess.
 *
 * Principle: no fallbacks. If the cli package can't be located or the subprocess
 * fails to start, throw immediately so the failure surfaces.
 */
export class EmbeddedRunner {
    private process: Subprocess | null = null
    private readonly apiUrl: string
    private readonly cliApiToken: string
    private readonly cliEntry: string
    private readonly hapiHome?: string
    private readonly verbose: boolean

    constructor(options: EmbeddedRunnerOptions) {
        this.apiUrl = options.apiUrl
        this.cliApiToken = options.cliApiToken
        this.hapiHome = options.hapiHome
        this.verbose = options.verbose ?? true

        // Find the cli package's index.ts.
        // Default layout: hub/src/web/embeddedRunner.ts → ../../../cli/src/index.ts
        const cliDir = options.cliDir ?? join(import.meta.dir, '..', '..', '..', 'cli')
        const entry = join(cliDir, 'src', 'index.ts')
        if (!existsSync(entry)) {
            throw new Error(`[EmbeddedRunner] cli entry not found at ${entry}. Set options.cliDir explicitly.`)
        }
        this.cliEntry = entry
    }

    async start(): Promise<void> {
        if (this.process) {
            throw new Error('[EmbeddedRunner] already started')
        }

        // The runner subprocess (and the wrapper subprocesses it forks) need to
        // be able to find the `claude` binary on PATH. When hub itself is
        // launched via setsid/nohup/systemd with a stripped environment, PATH
        // can be missing ~/.local/bin (npm-user installs) and ~/.bun/bin —
        // which causes findGlobalClaudePath() inside the wrapper to throw
        // 'Claude Code CLI not found on PATH'. claudeRemoteLauncher's catch
        // silently restarts on every message, so the bot looks hung but is
        // really retrying-forever. Prepend the standard user-local bin dirs
        // so this can't happen even with a hostile parent env.
        const homeDir = process.env.HOME ?? '/home'
        const extraPathSegments = [
            `${homeDir}/.local/bin`,
            `${homeDir}/.bun/bin`
        ]
        const existingPath = process.env.PATH ?? ''
        const existingSegments = new Set(existingPath.split(':').filter(Boolean))
        const prepend = extraPathSegments.filter((seg) => !existingSegments.has(seg))
        const mergedPath = prepend.length > 0
            ? `${prepend.join(':')}:${existingPath}`
            : existingPath

        const env: Record<string, string> = {
            ...process.env as Record<string, string>,
            PATH: mergedPath,
            HAPI_API_URL: this.apiUrl,
            CLI_API_TOKEN: this.cliApiToken
        }
        if (this.hapiHome) {
            env.HAPI_HOME = this.hapiHome
        }

        const child = spawn({
            // Use the absolute path of the bun runtime that's running THIS hub
            // process. Relying on PATH lookup ("bun") fails when hub's PATH
            // doesn't include ~/.bun/bin (which can happen when hub is started
            // via setsid, env, or a stripped-env nohup wrapper). process.execPath
            // is always set to the running interpreter and works regardless of
            // shell environment.
            cmd: [process.execPath, this.cliEntry, 'runner', 'start-sync'],
            env,
            stdout: this.verbose ? 'pipe' : 'ignore',
            stderr: this.verbose ? 'pipe' : 'ignore',
            stdin: 'ignore'
        })

        this.process = child

        if (this.verbose) {
            this.pipeOutput(child.stdout, '[embedded-runner]')
            this.pipeOutput(child.stderr, '[embedded-runner!]')
        }

        // Watch for unexpected exits — surface immediately.
        void child.exited.then((code) => {
            if (this.process === child) {
                this.process = null
                console.error(`[EmbeddedRunner] subprocess exited with code ${code}`)
            }
        })

        console.log(`[EmbeddedRunner] started subprocess pid=${child.pid} → ${this.apiUrl}`)
    }

    async stop(): Promise<void> {
        const child = this.process
        if (!child) return
        this.process = null
        try {
            child.kill('SIGTERM')
            const exited = await Promise.race([
                child.exited,
                new Promise<number>((resolve) => setTimeout(() => resolve(-1), 5000))
            ])
            if (exited === -1) {
                child.kill('SIGKILL')
            }
        } catch (err) {
            console.error('[EmbeddedRunner] error during stop:', err)
        }
    }

    isRunning(): boolean {
        return this.process !== null
    }

    private async pipeOutput(stream: ReadableStream<Uint8Array> | undefined, prefix: string): Promise<void> {
        if (!stream) return
        const reader = stream.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        try {
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                buffer += decoder.decode(value, { stream: true })
                let idx: number
                while ((idx = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, idx)
                    buffer = buffer.slice(idx + 1)
                    if (line.length > 0) {
                        console.log(`${prefix} ${line}`)
                    }
                }
            }
        } catch {
            // Stream closed
        }
    }
}
