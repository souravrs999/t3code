#!/usr/bin/env node

/**
 * Build Tauri artifacts and copy them to the `release/` directory with the same
 * naming convention as the Electron build: `T3-Code-{VERSION}-{ARCH}.{EXT}`.
 *
 * Mirrors `build-desktop-artifact.ts` — same CLI flags, env vars, icon pipeline,
 * artifact naming, and output directory.
 *
 * Usage:
 *   node scripts/build-tauri-artifact.ts --platform mac --target dmg [--arch arm64]
 */

import { BRAND_ASSET_PATHS } from "./lib/brand-assets.ts";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Config, Data, Effect, FileSystem, Layer, Logger, Option, Path, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const BuildPlatform = Schema.Literals(["mac", "linux", "win"]);
const BuildArch = Schema.Literals(["arm64", "x64"]);

const RepoRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(new URL("..", import.meta.url))),
);
const ProductionMacIconSource = Effect.zipWith(RepoRoot, Effect.service(Path.Path), (repoRoot, path) =>
  path.join(repoRoot, BRAND_ASSET_PATHS.productionMacIconPng),
);
const ProductionLinuxIconSource = Effect.zipWith(
  RepoRoot,
  Effect.service(Path.Path),
  (repoRoot, path) => path.join(repoRoot, BRAND_ASSET_PATHS.productionLinuxIconPng),
);
const ProductionWindowsIconSource = Effect.zipWith(
  RepoRoot,
  Effect.service(Path.Path),
  (repoRoot, path) => path.join(repoRoot, BRAND_ASSET_PATHS.productionWindowsIconIco),
);

interface PlatformConfig {
  readonly defaultTarget: string;
  readonly archChoices: ReadonlyArray<typeof BuildArch.Type>;
  readonly extensions: ReadonlyArray<string>;
}

const PLATFORM_CONFIG: Record<typeof BuildPlatform.Type, PlatformConfig> = {
  mac: {
    defaultTarget: "dmg",
    archChoices: ["arm64", "x64"],
    extensions: [".dmg", ".app.tar.gz"],
  },
  linux: {
    defaultTarget: "AppImage",
    archChoices: ["x64", "arm64"],
    extensions: [".AppImage", ".deb"],
  },
  win: {
    defaultTarget: "nsis",
    archChoices: ["x64", "arm64"],
    extensions: [".exe", ".msi"],
  },
};

// ─── Env config (mirrors T3CODE_DESKTOP_* from build-desktop-artifact.ts) ────

const BuildEnvConfig = Config.all({
  platform: Config.schema(BuildPlatform, "T3CODE_DESKTOP_PLATFORM").pipe(Config.option),
  target: Config.string("T3CODE_DESKTOP_TARGET").pipe(Config.option),
  arch: Config.schema(BuildArch, "T3CODE_DESKTOP_ARCH").pipe(Config.option),
  version: Config.string("T3CODE_DESKTOP_VERSION").pipe(Config.option),
  outputDir: Config.string("T3CODE_DESKTOP_OUTPUT_DIR").pipe(Config.option),
  skipBuild: Config.boolean("T3CODE_DESKTOP_SKIP_BUILD").pipe(Config.withDefault(false)),
  verbose: Config.boolean("T3CODE_DESKTOP_VERBOSE").pipe(Config.withDefault(false)),
});

class BuildScriptError extends Data.TaggedError("BuildScriptError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function detectHostBuildPlatform(hostPlatform: string): typeof BuildPlatform.Type | undefined {
  if (hostPlatform === "darwin") return "mac";
  if (hostPlatform === "linux") return "linux";
  if (hostPlatform === "win32") return "win";
  return undefined;
}

function getDefaultArch(platform: typeof BuildPlatform.Type): typeof BuildArch.Type {
  const config = PLATFORM_CONFIG[platform];
  if (process.arch === "arm64" && config.archChoices.includes("arm64")) return "arm64";
  if (process.arch === "x64" && config.archChoices.includes("x64")) return "x64";
  return config.archChoices[0] ?? "x64";
}

const resolveBooleanFlag = (flag: Option.Option<boolean>, envValue: boolean) =>
  Option.getOrElse(Option.filter(flag, Boolean), () => envValue);
const mergeOptions = <A>(a: Option.Option<A>, b: Option.Option<A>, defaultValue: A) =>
  Option.getOrElse(a, () => Option.getOrElse(b, () => defaultValue));

const commandOutputOptions = (verbose: boolean) =>
  ({
    stdout: verbose ? "inherit" : "ignore",
    stderr: "inherit",
  }) as const;

const runCommand = Effect.fn("runCommand")(function* (command: ChildProcess.Command) {
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* commandSpawner.spawn(command);
  const exitCode = yield* child.exitCode;

  if (exitCode !== 0) {
    return yield* new BuildScriptError({
      message: `Command exited with non-zero exit code (${exitCode})`,
    });
  }
});

// ─── Icon staging (same pipeline as build-desktop-artifact.ts) ───────────────

function generateMacIconSet(
  sourcePng: string,
  targetIcns: string,
  tmpRoot: string,
  path: Path.Path,
  verbose: boolean,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const iconsetDir = path.join(tmpRoot, "icon.iconset");
    yield* fs.makeDirectory(iconsetDir, { recursive: true });

    const iconSizes = [16, 32, 128, 256, 512] as const;
    for (const size of iconSizes) {
      yield* runCommand(
        ChildProcess.make({
          ...commandOutputOptions(verbose),
        })`sips -z ${size} ${size} ${sourcePng} --out ${path.join(iconsetDir, `icon_${size}x${size}.png`)}`,
      );

      const retinaSize = size * 2;
      yield* runCommand(
        ChildProcess.make({
          ...commandOutputOptions(verbose),
        })`sips -z ${retinaSize} ${retinaSize} ${sourcePng} --out ${path.join(iconsetDir, `icon_${size}x${size}@2x.png`)}`,
      );
    }

    yield* runCommand(
      ChildProcess.make({
        ...commandOutputOptions(verbose),
      })`iconutil -c icns ${iconsetDir} -o ${targetIcns}`,
    );
  });
}

function stageTauriIcons(platform: typeof BuildPlatform.Type, tauriIconsDir: string, verbose: boolean) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    if (platform === "mac") {
      const iconSource = yield* ProductionMacIconSource;
      if (!(yield* fs.exists(iconSource))) {
        return yield* new BuildScriptError({
          message: `Production icon source is missing at ${iconSource}`,
        });
      }

      const tmpRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-icon-build-" });

      // Generate icon.icns from production 1024px source
      yield* generateMacIconSet(iconSource, path.join(tauriIconsDir, "icon.icns"), tmpRoot, path, verbose);

      // Generate icon.png (512px)
      yield* runCommand(
        ChildProcess.make({
          ...commandOutputOptions(verbose),
        })`sips -z 512 512 ${iconSource} --out ${path.join(tauriIconsDir, "icon.png")}`,
      );

      // Generate sized PNGs for Tauri
      yield* runCommand(
        ChildProcess.make({
          ...commandOutputOptions(verbose),
        })`sips -z 32 32 ${iconSource} --out ${path.join(tauriIconsDir, "32x32.png")}`,
      );
      yield* runCommand(
        ChildProcess.make({
          ...commandOutputOptions(verbose),
        })`sips -z 128 128 ${iconSource} --out ${path.join(tauriIconsDir, "128x128.png")}`,
      );
      yield* runCommand(
        ChildProcess.make({
          ...commandOutputOptions(verbose),
        })`sips -z 256 256 ${iconSource} --out ${path.join(tauriIconsDir, "128x128@2x.png")}`,
      );
    }

    if (platform === "linux") {
      const iconSource = yield* ProductionLinuxIconSource;
      if (!(yield* fs.exists(iconSource))) {
        return yield* new BuildScriptError({
          message: `Production icon source is missing at ${iconSource}`,
        });
      }
      yield* fs.copyFile(iconSource, path.join(tauriIconsDir, "icon.png"));
    }

    if (platform === "win") {
      const iconSource = yield* ProductionWindowsIconSource;
      if (!(yield* fs.exists(iconSource))) {
        return yield* new BuildScriptError({
          message: `Production Windows icon source is missing at ${iconSource}`,
        });
      }
      yield* fs.copyFile(iconSource, path.join(tauriIconsDir, "icon.ico"));
    }
  });
}

// ─── Build pipeline ──────────────────────────────────────────────────────────

interface BuildCliInput {
  readonly platform: Option.Option<typeof BuildPlatform.Type>;
  readonly target: Option.Option<string>;
  readonly arch: Option.Option<typeof BuildArch.Type>;
  readonly buildVersion: Option.Option<string>;
  readonly outputDir: Option.Option<string>;
  readonly skipBuild: Option.Option<boolean>;
  readonly verbose: Option.Option<boolean>;
}

interface ResolvedBuildOptions {
  readonly platform: typeof BuildPlatform.Type;
  readonly target: string;
  readonly arch: typeof BuildArch.Type;
  readonly version: string | undefined;
  readonly outputDir: string;
  readonly skipBuild: boolean;
  readonly verbose: boolean;
}

const resolveBuildOptions = Effect.fn("resolveBuildOptions")(function* (input: BuildCliInput) {
  const path = yield* Path.Path;
  const repoRoot = yield* RepoRoot;
  const env = yield* BuildEnvConfig.asEffect();

  const platform = mergeOptions(input.platform, env.platform, detectHostBuildPlatform(process.platform));
  if (!platform) {
    return yield* new BuildScriptError({ message: `Unsupported host platform '${process.platform}'.` });
  }

  const target = mergeOptions(input.target, env.target, PLATFORM_CONFIG[platform].defaultTarget);
  const arch = mergeOptions(input.arch, env.arch, getDefaultArch(platform));
  const version = mergeOptions(input.buildVersion, env.version, undefined);
  const outputDir = path.resolve(repoRoot, mergeOptions(input.outputDir, env.outputDir, "release"));
  const skipBuild = resolveBooleanFlag(input.skipBuild, env.skipBuild);
  const verbose = resolveBooleanFlag(input.verbose, env.verbose);

  return { platform, target, arch, version, outputDir, skipBuild, verbose } satisfies ResolvedBuildOptions;
});

const buildTauriArtifact = Effect.fn("buildTauriArtifact")(function* (options: ResolvedBuildOptions) {
  const repoRoot = yield* RepoRoot;
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;

  const tauriDir = path.join(repoRoot, "apps", "tauri");
  const tauriIconsDir = path.join(tauriDir, "icons");
  const serverDir = path.join(repoRoot, "apps", "server");

  // Read version from tauri.conf.json (or use override)
  const tauriConfPath = path.join(tauriDir, "tauri.conf.json");
  const tauriConf = JSON.parse(yield* fs.readFileString(tauriConfPath));
  const appVersion = options.version ?? tauriConf.version;

  // ── Stage production icons ──────────────────────────────────────────────
  yield* Effect.log(`[tauri-artifact] Staging production icons for ${options.platform}...`);
  yield* stageTauriIcons(options.platform, tauriIconsDir, options.verbose);

  // ── Build server + tauri ────────────────────────────────────────────────
  if (!options.skipBuild) {
    yield* Effect.log("[tauri-artifact] Building server...");
    yield* runCommand(
      ChildProcess.make({
        cwd: serverDir,
        ...commandOutputOptions(options.verbose),
      })`bun run build`,
    );

    yield* Effect.log(
      `[tauri-artifact] Building ${options.platform}/${options.target} (arch=${options.arch}, version=${appVersion})...`,
    );
    yield* runCommand(
      ChildProcess.make({
        cwd: tauriDir,
        ...commandOutputOptions(options.verbose),
      })`bunx tauri build`,
    );
  }

  // ── Locate and rename artifacts ─────────────────────────────────────────
  const bundleDir = path.join(tauriDir, "target", "release", "bundle");
  if (!(yield* fs.exists(bundleDir))) {
    return yield* new BuildScriptError({ message: `Bundle directory not found: ${bundleDir}` });
  }

  yield* fs.makeDirectory(options.outputDir, { recursive: true });

  const platformConfig = PLATFORM_CONFIG[options.platform];
  const copiedArtifacts: string[] = [];

  // Recursively find matching artifacts
  const scanDir = (dir: string): Effect.Effect<string[]> =>
    Effect.gen(function* () {
      const results: string[] = [];
      const dirExists = yield* fs.exists(dir);
      if (!dirExists) return results;

      const entries = yield* fs.readDirectory(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stat = yield* fs.stat(fullPath);
        if (stat.type === "Directory") {
          results.push(...(yield* scanDir(fullPath)));
        } else if (platformConfig.extensions.some((ext) => entry.endsWith(ext))) {
          results.push(fullPath);
        }
      }
      return results;
    }).pipe(Effect.catch(() => Effect.succeed([] as string[])));

  const artifacts = yield* scanDir(bundleDir);

  for (const artifactPath of artifacts) {
    const originalName = path.basename(artifactPath);

    // Extract extension (handle compound extensions like .app.tar.gz)
    let ext: string;
    if (originalName.endsWith(".app.tar.gz")) {
      ext = ".app.tar.gz";
    } else {
      ext = path.extname(originalName);
    }

    // Rename to match Electron convention: T3-Code-{VERSION}-{ARCH}.{EXT}
    const targetName = `T3-Code-${appVersion}-${options.arch}${ext}`;
    const targetPath = path.join(options.outputDir, targetName);

    yield* Effect.log(`  ${originalName} → ${targetName}`);
    yield* fs.copyFile(artifactPath, targetPath);
    copiedArtifacts.push(targetPath);
  }

  if (copiedArtifacts.length === 0) {
    return yield* new BuildScriptError({
      message: `Build completed but no artifacts were found in ${bundleDir}`,
    });
  }

  yield* Effect.log("[tauri-artifact] Done. Artifacts:").pipe(
    Effect.annotateLogs({ artifacts: copiedArtifacts }),
  );
});

// ─── CLI ─────────────────────────────────────────────────────────────────────

const buildTauriArtifactCli = Command.make("build-tauri-artifact", {
  platform: Flag.choice("platform", BuildPlatform.literals).pipe(
    Flag.withDescription("Build platform (env: T3CODE_DESKTOP_PLATFORM)."),
    Flag.optional,
  ),
  target: Flag.string("target").pipe(
    Flag.withDescription("Artifact target, for example dmg/AppImage/nsis (env: T3CODE_DESKTOP_TARGET)."),
    Flag.optional,
  ),
  arch: Flag.choice("arch", BuildArch.literals).pipe(
    Flag.withDescription("Build arch, for example arm64/x64 (env: T3CODE_DESKTOP_ARCH)."),
    Flag.optional,
  ),
  buildVersion: Flag.string("build-version").pipe(
    Flag.withDescription("Artifact version metadata (env: T3CODE_DESKTOP_VERSION)."),
    Flag.optional,
  ),
  outputDir: Flag.string("output-dir").pipe(
    Flag.withDescription("Output directory for artifacts (env: T3CODE_DESKTOP_OUTPUT_DIR)."),
    Flag.optional,
  ),
  skipBuild: Flag.boolean("skip-build").pipe(
    Flag.withDescription("Skip building and use existing dist artifacts (env: T3CODE_DESKTOP_SKIP_BUILD)."),
    Flag.optional,
  ),
  verbose: Flag.boolean("verbose").pipe(
    Flag.withDescription("Stream subprocess stdout (env: T3CODE_DESKTOP_VERBOSE)."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Build a Tauri desktop artifact for T3 Code."),
  Command.withHandler((input) => Effect.flatMap(resolveBuildOptions(input), buildTauriArtifact)),
);

const cliRuntimeLayer = Layer.mergeAll(Logger.layer([Logger.consolePretty()]), NodeServices.layer);

Command.run(buildTauriArtifactCli, { version: "0.0.0" }).pipe(
  Effect.scoped,
  Effect.provide(cliRuntimeLayer),
  NodeRuntime.runMain,
);
