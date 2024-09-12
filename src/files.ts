import fs from "fs";
import crypto from "crypto";
import path from "path";
import { FileEntry } from "./types.js";

export async function getAllFiles(
  dirPath: string,
  arrayOfFiles: FileEntry[] = [],
  basePath: string = dirPath,
): Promise<FileEntry[]> {
  const files = await fs.promises.readdir(dirPath);

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stats = await fs.promises.stat(filePath);
    if (stats.isDirectory()) {
      arrayOfFiles = await getAllFiles(filePath, arrayOfFiles, basePath);
    } else {
      const fileBuffer = await fs.promises.readFile(filePath);
      const x = crypto.createHash("sha256").update(fileBuffer).digest("hex");
      const relativePath = path.relative(basePath, filePath);
      arrayOfFiles.push({
        remotePath: relativePath,
        localPath: filePath,
        sha256: x,
        changedAt: Math.floor((stats.mtime.getTime() || stats.birthtime.getTime() || 0) / 1000), // convert to unix time in secs
      });
    }
  }

  return arrayOfFiles;
}

export async function compareFiles(
  localFiles: FileEntry[],
  remoteFiles: FileEntry[],
): Promise<{
  toUpload: FileEntry[];
  existing: FileEntry[];
  toDelete: FileEntry[];
}> {
  const toUpload: FileEntry[] = [];
  const existing: FileEntry[] = [];
  const toDelete: FileEntry[] = [];

  // Create a map of remote files for faster lookup
  const remoteFileMap: Record<string, FileEntry> = remoteFiles.reduce(
    (map, file) => {
      map[file.remotePath] = file;
      return map;
    },
    {} as Record<string, FileEntry>,
  );

  // Compare local files with remote files
  for (const localFile of localFiles) {
    const remoteFile = remoteFileMap[localFile.remotePath];
    if (!remoteFile) {
      toUpload.push(localFile);
    } else if (localFile.sha256 !== remoteFile.sha256) {
      toUpload.push(localFile);
    } else {
      existing.push(localFile);
    }
    // Remove the file from the map as it's been processed
    delete remoteFileMap[localFile.remotePath];
  }

  // Any remaining files in the remoteFileMap should be deleted
  toDelete.push(...Object.values(remoteFileMap));

  return { toUpload, existing, toDelete };
}
