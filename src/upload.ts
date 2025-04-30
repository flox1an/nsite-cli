import NDK from "@nostr-dev-kit/ndk";
import { BlossomClient, EventTemplate, SignedEvent } from "blossom-client-sdk";
import { multiServerUpload } from "blossom-client-sdk/actions/multi-server";
import debug from "debug";
import fs from "fs";
import mime from "mime-types";
import pLimit from "p-limit";

import { colors } from "./colors.js";
import { publishNSiteEvent } from "./nostr.js";
import { FileList } from "./types.js";

const log = debug("nsite:upload");

export function formatFileStatus(fileName: string, action: string, details?: string): string {
  const detailsText = details ? ` (${details})` : "";
  return `${action} ${colors.filePath(fileName)}${detailsText}`;
}

export interface UploadOptions {
  concurrency?: number;
}

export async function processUploads(
  ndk: NDK,
  filesToUpload: FileList,
  blossomServers: string[],
  signEventTemplate: (template: EventTemplate) => Promise<SignedEvent>,
  options: UploadOptions = {},
) {
  const pubkey = ndk.activeUser?.pubkey;

  if (!pubkey) throw new Error("User Pubkey not found.");

  if (filesToUpload.length === 0) {
    console.log("No files to upload.");
    return;
  }

  // Set default options
  const concurrency = options.concurrency || 5;

  // Create a concurrency limit
  const limit = pLimit(concurrency);

  console.log(`Uploading ${colors.count(filesToUpload.length)} files with concurrency ${colors.count(concurrency)}...`);

  // Track results
  const results = {
    successful: 0,
    failed: 0,
    fileResults: [] as Array<{ file: string; success: boolean; uploadedServers: number; totalServers: number }>,
  };

  // Map to track active uploads
  const activeUploads = new Map<string, { file: string; startTime: number }>();

  // Log active uploads header
  console.log(colors.header("\nUploading files:"));

  // Create upload promises with concurrency limit
  const uploadPromises = filesToUpload.map((f) => {
    return limit(async () => {
      const shortFileName = f.localPath.split("/").pop() || f.localPath;

      // Mark this file as active
      const startTime = Date.now();
      activeUploads.set(shortFileName, { file: f.remotePath, startTime });

      log("Publishing ", f.localPath, f.remotePath, f.sha256);

      try {
        const buffer = fs.readFileSync(f.localPath);

        const fileName = f.localPath.split("/").pop();
        if (!fileName) {
          throw new Error(`Could not determine file name for ${f.localPath}`);
        }

        const mimeType = mime.lookup(f.localPath) || "application/octet-stream";
        const file = new File([buffer], fileName, { type: mimeType, lastModified: f.changedAt });

        // Track uploads for this file
        const serverStatus = new Map<string, "pending" | "success" | "error">();
        blossomServers.forEach((server) => serverStatus.set(server, "pending"));

        // Track upload counts
        let successCount = 0;
        let failCount = 0;

        // Helper function to update progress status
        const updateFileProgress = () => {
          const completedCount = Array.from(serverStatus.values()).filter((s) => s === "success").length;
          const failedCount = Array.from(serverStatus.values()).filter((s) => s === "error").length;
          log(`Progress for ${fileName}: ${completedCount}/${blossomServers.length} servers (${failedCount} failed)`);
        };

        const uploads = await multiServerUpload(blossomServers, file, {
          onError(server, sha256, blob, error) {
            serverStatus.set(server, "error");
            failCount++;
            updateFileProgress();
            log(`Error uploading ${f.remotePath} to ${server}: ${error.message}`);
          },
          onUpload(server, blob) {
            serverStatus.set(server, "success");
            successCount++;
            updateFileProgress();
            log(`Uploaded ${f.remotePath} to ${server} (SHA256: ${f.sha256})`);
          },
          onAuth: (server, blob) => {
            return BlossomClient.createUploadAuth(signEventTemplate, blob);
          },
        });

        const uploadedServers = Array.from(uploads.values()).length;
        const success = uploadedServers > 0;

        if (success) {
          await publishNSiteEvent(ndk, pubkey, f.remotePath, f.sha256);
          results.successful++;

          // Calculate time taken
          const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);

          // Success message with servers count and time taken
          const status = `${colors.success(uploadedServers)}/${colors.count(blossomServers.length)} servers in ${colors.count(timeTaken)}s`;
          if (failCount > 0) {
            console.log(
              formatFileStatus(
                shortFileName,
                colors.success("✓ Uploaded"),
                `${status} ${colors.error(failCount)} failed`,
              ),
            );
          } else {
            console.log(formatFileStatus(shortFileName, colors.success("✓ Uploaded"), status));
          }
        } else {
          results.failed++;
          console.log(formatFileStatus(shortFileName, colors.error("✗ Failed"), "No servers available"));
        }

        // Add to results
        results.fileResults.push({ file: f.remotePath, success, uploadedServers, totalServers: blossomServers.length });

        return { file: f.remotePath, success, uploadedServers, totalServers: blossomServers.length };
      } catch (err) {
        console.error(`Error uploading '${f.localPath}'`, err);
        results.failed++;

        // Show error message
        console.log(formatFileStatus(shortFileName, colors.error("✗ Error"), String(err)));

        // Add to results
        results.fileResults.push({
          file: f.remotePath,
          success: false,
          uploadedServers: 0,
          totalServers: blossomServers.length,
        });

        return { file: f.remotePath, success: false, error: err };
      } finally {
        // Mark as complete by removing from active uploads
        activeUploads.delete(shortFileName);
      }
    });
  });

  // Wait for all uploads to complete
  await Promise.all(uploadPromises);

  // Print summary with colors
  console.log(colors.header("\nUpload Summary:"));
  console.log(`- Total files: ${colors.count(filesToUpload.length)}`);
  console.log(`- Successfully uploaded: ${colors.success(results.successful)}`);
  console.log(`- Failed: ${results.failed > 0 ? colors.error(results.failed) : colors.success(0)}`);

  return results;
}
