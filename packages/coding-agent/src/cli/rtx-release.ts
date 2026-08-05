export const RTX_RELEASE_REPO = "therealtimex/rtx";

export interface RtxReleaseAsset {
	name: string;
	browser_download_url: string;
}

export interface RtxReleaseInfo {
	tag: string;
	version: string;
	targetCommitish?: string;
	prerelease: boolean;
	assets: RtxReleaseAsset[];
}

interface GithubReleasePayload {
	tag_name?: unknown;
	target_commitish?: unknown;
	prerelease?: unknown;
	assets?: unknown;
}

interface GithubReleaseAssetPayload {
	name?: unknown;
	browser_download_url?: unknown;
}

export function normalizeGithubReleaseVersion(tagName: string): string {
	const version = tagName.trim().replace(/^v/i, "");
	if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
		throw new Error(`Release tag "${tagName}" is not a semver version`);
	}
	return version;
}

export function getRtxReleaseAssetName(
	platform: NodeJS.Platform = process.platform,
	arch: NodeJS.Architecture = process.arch,
): string {
	let osName: string;
	switch (platform) {
		case "linux":
			osName = "linux";
			break;
		case "darwin":
			osName = "darwin";
			break;
		case "win32":
			osName = "windows";
			break;
		default:
			throw new Error(`Unsupported platform: ${platform}`);
	}

	let archName: string;
	switch (arch) {
		case "x64":
			archName = "x64";
			break;
		case "arm64":
			archName = "arm64";
			break;
		default:
			throw new Error(`Unsupported architecture: ${arch}`);
	}

	const suffix = platform === "win32" ? ".exe" : "";
	return `rtx-${osName}-${archName}${suffix}`;
}

export function findRtxReleaseAsset(release: RtxReleaseInfo, assetName: string): RtxReleaseAsset {
	const asset = release.assets.find(candidate => candidate.name === assetName);
	if (!asset) {
		throw new Error(`Release ${release.tag} does not include asset ${assetName}`);
	}
	return asset;
}

function parseGithubReleasePayload(payload: GithubReleasePayload): RtxReleaseInfo {
	if (typeof payload.tag_name !== "string" || payload.tag_name.trim().length === 0) {
		throw new Error("GitHub release response did not include a tag name");
	}

	const assets = Array.isArray(payload.assets)
		? payload.assets.flatMap((asset): RtxReleaseAsset[] => {
				const candidate = asset as GithubReleaseAssetPayload;
				if (typeof candidate.name !== "string" || typeof candidate.browser_download_url !== "string") {
					return [];
				}
				return [{ name: candidate.name, browser_download_url: candidate.browser_download_url }];
			})
		: [];

	return {
		tag: payload.tag_name,
		version: normalizeGithubReleaseVersion(payload.tag_name),
		...(typeof payload.target_commitish === "string" && payload.target_commitish.length > 0
			? { targetCommitish: payload.target_commitish }
			: {}),
		prerelease: payload.prerelease === true,
		assets,
	};
}

export async function fetchLatestRtxRelease(
	fetchImpl: typeof fetch = fetch,
	init?: RequestInit,
): Promise<RtxReleaseInfo> {
	const response = await fetchImpl(`https://api.github.com/repos/${RTX_RELEASE_REPO}/releases/latest`, {
		...init,
		headers: { Accept: "application/vnd.github+json", ...init?.headers },
	});
	if (!response.ok) {
		throw new Error(`Failed to fetch latest GitHub release: ${response.statusText}`);
	}
	return parseGithubReleasePayload((await response.json()) as GithubReleasePayload);
}

export async function fetchLatestRtxReleaseVersion(fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
	return (await fetchLatestRtxRelease(fetchImpl)).version;
}
