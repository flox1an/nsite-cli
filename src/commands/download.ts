import { BlossomClient } from "blossom-client-sdk";
import { Command } from "commander";
import debug from "debug";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { nip19 } from "nostr-tools";
import pLimit from "p-limit";
import path from "path";

import { findBlossomServers } from "../blossom.js";
import { colors } from "../colors.js";
import { compareFiles as compareFileLists, getLocalFiles as findAllLocalFiles } from "../files.js";
import { listRemoteFiles } from "../nostr.js";
import { getNDK, initNdk, logFiles } from "./common.js";

const log = debug("nsite");

export default function registerDownloadCommand(program: Command) {
  program
    .command("download")
    .argument("<targetfolder>", "The folder where the files should be downloaded to.")
    .argument("<npub>", "The public key (npub) of web content to download from.")
    .option("-s, --servers <servers>", "The blossom servers to use (comma separated).", undefined)
    .option("-r, --relays <relays>", "The NOSTR relays to use (comma separated).", undefined)
    .option("-v, --verbose", "Verbose output, i.e. print lists of files uploaded.")
    .option("-c, --concurrency <number>", "Number of concurrent downloads (default: 5)", "5")
    .option("-p, --purge", "Delete extra local files.", false)
    .description("Download all files available online")
    .action(
      async (
        targetFolder: string,
        npub: string,
        options: { servers?: string; relays?: string; verbose: boolean; purge: boolean; concurrency: string },
      ) => {
        debug(`download to ${targetFolder} from ${npub}`);

        const user = await initNdk(npub, [...(options.relays?.split(",") || [])]);
        if (!getNDK()) throw new Error("Failed to initialize NDK");

        const blossomServers = await findBlossomServers(getNDK()!, user, true, false, [
          ...(options.servers?.split(",") || []),
        ]);

        const optionalPubKey = npub && (nip19.decode(npub).data as string);
        log("Downloading web content for " + (npub || user.npub));
        const onlineFiles = await listRemoteFiles(getNDK()!, optionalPubKey || user.pubkey);
        logFiles(onlineFiles, options);

        const localFiles = await findAllLocalFiles(targetFolder);
        console.log(`${colors.count(localFiles.length)} files found locally in ${colors.filePath(targetFolder)}`);
        logFiles(localFiles, options);

        const { toTransfer, existing, toDelete } = await compareFileLists(onlineFiles, localFiles);
        console.log(
          `${colors.count(toTransfer.length)} new files to download, ${colors.count(existing.length)} files unchanged, ${colors.count(toDelete.length)} files to delete locally.`,
        );

        // Limit concurrent downloads to 5 at a time
        const limit = pLimit(options.concurrency ? parseInt(options.concurrency) : 5);

        // Download new files with concurrency limit
        await Promise.all(
          toTransfer.map((file) =>
            limit(async () => {
              const filePath = path.join(targetFolder, file.remotePath);
              const dir = path.dirname(filePath);

              if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

              let downloadSuccess = false;
              for (const server of blossomServers) {
                try {
                  const content = await BlossomClient.downloadBlob(server, file.sha256);
                  writeFileSync(filePath, Buffer.from(await content.arrayBuffer()));
                  console.log(`Downloaded ${file.remotePath} to ${filePath} from server ${server}`);
                  downloadSuccess = true;
                  break;
                } catch (error) {
                  log(`Failed to download ${file.remotePath} from server ${server}: ${error}`);
                }
              }
              if (!downloadSuccess) {
                console.log(colors.error(`All attempts to download ${colors.filePath(file.remotePath)} failed.`));
              }
            }),
          ),
        );

        // Remove extra local files if purge is enabled with concurrency limit
        if (options.purge) {
          await Promise.all(
            toDelete.map((file) => async () => {
              const filePath = path.join(targetFolder, file.remotePath);
              try {
                rmSync(filePath);
              } catch (error) {
                console.log(colors.error(`Failed to delete ${colors.filePath(filePath)}`));
                console.log(colors.error(String(error)));
              }
            }),
          );
        }

        process.exit(0);
      },
    );
}
