import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { buildNpmPackages, releaseTargets } from "./ci-release-npm.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe("release npm packages", () => {
	it("stages every release binary as an optional platform package", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "rtx-release-npm-test-"));
		temporaryDirectories.push(root);
		const artifactsDir = path.join(root, "artifacts");
		const outDir = path.join(root, "npm");
		await fs.mkdir(artifactsDir);
		for (const target of releaseTargets) {
			await Bun.write(path.join(artifactsDir, target.asset), target.asset);
		}

		await buildNpmPackages({ artifactsDir, outDir, version: "v1.2.3" });

		const main = await Bun.file(path.join(outDir, "main", "package.json")).json();
		expect(main).toMatchObject({
			name: "@realtimex/rtx",
			version: "1.2.3",
			bin: { rtx: "./bin/rtx.cjs" },
		});
		expect(main.optionalDependencies).toEqual(
			Object.fromEntries(releaseTargets.map(target => [`@realtimex/rtx-${target.packageSuffix}`, "1.2.3"])),
		);

		const windowsPackage = await Bun.file(
			path.join(outDir, "packages", "win32-x64", "package.json"),
		).json();
		expect(windowsPackage).toMatchObject({
			name: "@realtimex/rtx-win32-x64",
			version: "1.2.3",
			os: ["win32"],
			cpu: ["x64"],
		});
		expect(await Bun.file(path.join(outDir, "packages", "win32-x64", "bin", "rtx.exe")).text()).toBe(
			"rtx-windows-x64.exe",
		);
		const muslPackage = await Bun.file(path.join(outDir, "packages", "linux-musl-x64", "package.json")).json();
		expect(muslPackage.libc).toEqual(["musl"]);
	});

	it("rejects versions that npm cannot publish", async () => {
		await expect(
			buildNpmPackages({ artifactsDir: "/unused", outDir: "/unused", version: "release-latest" }),
		).rejects.toThrow("Invalid release version: release-latest");
	});
});
