import { invoke } from "../../api/backend";

export interface CliSnapshot {
  version: string | null;
  release: { version: string; size: number; ready?: boolean } | null;
}

export interface CliDownloadLinks {
  assetName: string;
  platform: string;
  packageUrl: string;
  metadataUrl: string;
  releaseUrl: string;
}

export const cliDownloadLinks = (version: string | null) =>
  invoke<CliDownloadLinks>("codex_gui_cli_manual_download", { version });

export const importCliPackage = (request: { packagePath: string; metadataPath: string }) =>
  invoke<CliSnapshot>("codex_gui_cli_import", { request });
