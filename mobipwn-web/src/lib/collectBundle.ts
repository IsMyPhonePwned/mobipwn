import { strToU8, unzipSync, zipSync } from "fflate";

export type MagpieArtifactBundle = {
  processesJson: string;
  filesJson: string;
  yaraJson: string;
  findPaths: string[];
  yaraPaths: string[];
  maxDepth: number;
  hashFiles: boolean;
  maxHashSize: number;
  excludeDirs: string[];
  yaraMaxDepth: number;
  commands?: string[];
};

function magpieManifest(magpie: MagpieArtifactBundle): string {
  return JSON.stringify(
    {
      collector: "rusty-magpie",
      upstream: "https://github.com/CERT-EDF/rusty-magpie",
      collected_at: new Date().toISOString(),
      commands: magpie.commands ?? [],
      find_paths: magpie.findPaths,
      max_depth: magpie.maxDepth,
      hash_files: magpie.hashFiles,
      max_hash_size: magpie.maxHashSize,
      exclude_dirs: magpie.excludeDirs,
      yara_paths: magpie.yaraPaths,
      yara_max_depth: magpie.yaraMaxDepth,
    },
    null,
    2
  );
}

/** Zip containing only mobipwn-collector/* (Rusty Magpie-only upload). */
export function buildMagpieOnlyZip(magpie: MagpieArtifactBundle): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "mobipwn-collector/manifest.json": strToU8(magpieManifest(magpie)),
    "mobipwn-collector/ps.json": strToU8(magpie.processesJson),
    "mobipwn-collector/find.json": strToU8(magpie.filesJson),
    "mobipwn-collector/yara.json": strToU8(magpie.yaraJson),
  };
  return zipSync(files, { level: 0 });
}

/** Append mobipwn-collector/* JSON files into an Android bugreport zip. */
export function appendMagpieToBugreportZip(
  bugreportZip: Uint8Array,
  magpie: MagpieArtifactBundle
): Uint8Array {
  const entries = unzipSync(bugreportZip);
  entries["mobipwn-collector/manifest.json"] = strToU8(magpieManifest(magpie));
  entries["mobipwn-collector/ps.json"] = strToU8(magpie.processesJson);
  entries["mobipwn-collector/find.json"] = strToU8(magpie.filesJson);
  entries["mobipwn-collector/yara.json"] = strToU8(magpie.yaraJson);
  return zipSync(entries, { level: 0 });
}

/** Wrap raw bugreport bytes + magpie JSON when the device returned an uncompressed dump. */
export function bundleBugreportWithMagpie(
  bugreport: Uint8Array,
  magpie: MagpieArtifactBundle,
  innerName = "bugreport.txt"
): Uint8Array {
  const files: Record<string, Uint8Array> = {
    [innerName]: bugreport,
    "mobipwn-collector/manifest.json": strToU8(magpieManifest(magpie)),
    "mobipwn-collector/ps.json": strToU8(magpie.processesJson),
    "mobipwn-collector/find.json": strToU8(magpie.filesJson),
    "mobipwn-collector/yara.json": strToU8(magpie.yaraJson),
  };
  return zipSync(files, { level: 0 });
}

export function looksLikeZip(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0x50 && data[1] === 0x4b;
}
