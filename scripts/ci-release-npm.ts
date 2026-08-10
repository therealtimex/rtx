#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { $ } from "bun";

interface ReleaseTarget {
	asset: string;
	packageSuffix: string;
	os: "darwin" | "linux" | "win32";
	cpu: "arm64" | "x64";
	binary: "rtx" | "rtx.exe";
	libc?: "glibc" | "musl";
}

interface PackageManifest {
	name: string;
	version: string;
}

export interface BuildNpmPackagesOptions {
	artifactsDir: string;
	outDir: string;
	version: string;
}

const mainPackageName = "@realtimex/rtx";

export const releaseTargets: readonly ReleaseTarget[] = [
	{
		asset: "rtx-darwin-arm64",
		packageSuffix: "darwin-arm64",
		os: "darwin",
		cpu: "arm64",
		binary: "rtx",
	},
	{
		asset: "rtx-darwin-x64",
		packageSuffix: "darwin-x64",
		os: "darwin",
		cpu: "x64",
		binary: "rtx",
	},
	{
		asset: "rtx-linux-arm64",
		packageSuffix: "linux-arm64",
		os: "linux",
		cpu: "arm64",
		binary: "rtx",
		libc: "glibc",
	},
	{
		asset: "rtx-linux-x64",
		packageSuffix: "linux-x64",
		os: "linux",
		cpu: "x64",
		binary: "rtx",
		libc: "glibc",
	},
	{
		asset: "rtx-linux-musl-arm64",
		packageSuffix: "linux-musl-arm64",
		os: "linux",
		cpu: "arm64",
		binary: "rtx",
		libc: "musl",
	},
	{
		asset: "rtx-linux-musl-x64",
		packageSuffix: "linux-musl-x64",
		os: "linux",
		cpu: "x64",
		binary: "rtx",
		libc: "musl",
	},
	{
		asset: "rtx-windows-x64.exe",
		packageSuffix: "win32-x64",
		os: "win32",
		cpu: "x64",
		binary: "rtx.exe",
	},
];

function packageName(target: ReleaseTarget): string {
	return `${mainPackageName}-${target.packageSuffix}`;
}

function validateVersion(version: string): string {
	const normalized = version.trim().replace(/^v/, "");
	if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(normalized)) {
		throw new Error(`Invalid release version: ${version}`);
	}
	return normalized;
}

async function writeJson(filePath: string, value: object): Promise<void> {
	await Bun.write(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function launcherSource(): string {
	return `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");

function usesMusl() {
	if (process.platform !== "linux") return false;
	const report = typeof process.report?.getReport === "function" ? process.report.getReport() : null;
	return !report?.header?.glibcVersionRuntime;
}

const suffix = process.platform === "linux"
	? \`linux-\${usesMusl() ? "musl-" : ""}\${process.arch}\`
	: \`\${process.platform}-\${process.arch}\`;
const packageName = \`@realtimex/rtx-\${suffix}\`;
const binaryName = process.platform === "win32" ? "rtx.exe" : "rtx";

let binary;
try {
	binary = require.resolve(\`\${packageName}/bin/\${binaryName}\`);
} catch {
	console.error(\`rtx does not provide a binary for \${process.platform}/\${process.arch} (package \${packageName}).\`);
	console.error("Reinstall @realtimex/rtx and make sure optional dependencies are enabled.");
	process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" });
if (result.error) {
	console.error(result.error.message);
	process.exit(1);
}
process.exit(result.status ?? 1);
`;
}

export async function buildNpmPackages(options: BuildNpmPackagesOptions): Promise<void> {
	const version = validateVersion(options.version);
	await fs.rm(options.outDir, { recursive: true, force: true });

	const optionalDependencies: Record<string, string> = {};
	for (const target of releaseTargets) {
		const source = path.join(options.artifactsDir, target.asset);
		const packageDir = path.join(options.outDir, "packages", target.packageSuffix);
		const binaryPath = path.join(packageDir, "bin", target.binary);
		await fs.mkdir(path.dirname(binaryPath), { recursive: true });
		await fs.copyFile(source, binaryPath);
		await fs.chmod(binaryPath, 0o755);

		const name = packageName(target);
		optionalDependencies[name] = version;
		await writeJson(path.join(packageDir, "package.json"), {
			name,
			version,
			description: `Platform binary for ${mainPackageName} (${target.packageSuffix})`,
			license: "MIT",
			os: [target.os],
			cpu: [target.cpu],
			...(target.libc ? { libc: [target.libc] } : {}),
			files: ["bin"],
			publishConfig: { access: "public" },
		});
		await Bun.write(
			path.join(packageDir, "README.md"),
			`# ${name}\n\nPlatform binary package for \`${mainPackageName}\`.\n`,
		);
	}

	const mainDir = path.join(options.outDir, "main");
	await fs.mkdir(path.join(mainDir, "bin"), { recursive: true });
	await writeJson(path.join(mainDir, "package.json"), {
		name: mainPackageName,
		version,
		description: "RealtimeX coding agent CLI",
		license: "MIT",
		bin: { rtx: "./bin/rtx.cjs" },
		files: ["bin", "README.md"],
		optionalDependencies,
		publishConfig: { access: "public" },
	});
	await Bun.write(path.join(mainDir, "bin", "rtx.cjs"), launcherSource());
	await Bun.write(path.join(mainDir, "README.md"), "# @realtimex/rtx\n\nRealtimeX coding agent CLI.\n");
}

async function publishPackage(packageDir: string): Promise<void> {
	const manifest = (await Bun.file(path.join(packageDir, "package.json")).json()) as PackageManifest;
	const spec = `${manifest.name}@${manifest.version}`;
	const existing = await $`npm view ${spec} version`.cwd(packageDir).quiet().nothrow();
	if (existing.exitCode === 0 && existing.text().trim() === manifest.version) {
		console.log(`${spec} already exists; skipping`);
		return;
	}
	await $`npm publish --access public`.cwd(packageDir);
}

export async function publishNpmPackages(outDir: string): Promise<void> {
	await $`npm whoami`.quiet();
	for (const target of releaseTargets) {
		await publishPackage(path.join(outDir, "packages", target.packageSuffix));
	}
	await publishPackage(path.join(outDir, "main"));
}

function optionValue(args: readonly string[], name: string): string {
	const index = args.indexOf(name);
	const value = index === -1 ? undefined : args[index + 1];
	if (!value) throw new Error(`${name} is required`);
	return value;
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const command = args[0];
	if (command === "build") {
		await buildNpmPackages({
			version: optionValue(args, "--version"),
			artifactsDir: path.resolve(optionValue(args, "--artifacts")),
			outDir: path.resolve(optionValue(args, "--out")),
		});
	} else if (command === "publish") {
		await publishNpmPackages(path.resolve(optionValue(args, "--out")));
	} else {
		throw new Error(
			"Usage: ci-release-npm.ts <build|publish> --out <directory> [--version <version> --artifacts <directory>]",
		);
	}
}
