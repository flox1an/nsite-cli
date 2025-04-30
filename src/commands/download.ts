import { Command } from "commander";
import debug from "debug";
import path from "path";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { nip19 } from "nostr-tools";
import { initNdk, logFiles, getNDK } from "./common.js";
import { getLocalFiles as findAllLocalFiles, compareFiles as compareFileLists } from "../files.js";
import { findBlossomServers } from "../blossom.js";
import { BlossomClient } from "blossom-client-sdk";
import { listRemoteFiles } from "../nostr.js";

const log = debug("nsite");

export default function registerDownloadCommand(program: Command) {
  program
    .command("download")
    .argument("<targetfolder>", "The folder where the files should be downloaded to.")
    .argument("<npub>", "The public key (npub) of web content to download from.")
    .option("-s, --servers <servers>", "The blossom servers to use (comma separated).", undefined)
    .option("-r, --relays <relays>", "The NOSTR relays to use (comma separated).", undefined)
    .option("-v, --verbose", "Verbose output, i.e. print lists of files uploaded.")
    .option("-p, --purge", "Delete extra local files.", false)
    .description("Download all files available online")
    .action(
      async (
        targetFolder: string,
        npub: string,
        options: { servers?: string; relays?: string; verbose: boolean; purge: boolean },
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
        console.log(`${localFiles.length} files found locally in ${targetFolder}`);
        logFiles(localFiles, options);

        const { toTransfer, existing, toDelete } = await compareFileLists(onlineFiles, localFiles);
        console.log(
          `${toTransfer.length} new files to download, ${existing.length} files unchanged, ${toDelete.length} files to delete locally.`,
        );

        // Download new files
        for (const file of toTransfer) {
          const filePath = path.join(targetFolder, file.remotePath);
          const dir = path.dirname(filePath);

          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

          let downloadSuccess = false;
          for (const server of blossomServers) {
            try {
              const content = await BlossomClient.downloadBlob(server, file.sha256);
              writeFileSync(filePath, Buffer.from(await content.arrayBuffer()));
              log(`Downloaded ${file.remotePath} to ${filePath} from server ${server}`);
              downloadSuccess = true;
              break;
            } catch (error) {
              log(`Failed to download ${file.remotePath} from server ${server}: ${error}`);
            }
          }
          if (!downloadSuccess) {
            console.log(`All attempts to download ${file.remotePath} failed.`);
          }
        }

        // Remove extra local files if purge is enabled
        if (options.purge) {
          for (const file of toDelete) {
            const filePath = path.join(targetFolder, file.remotePath);
            try {
              rmSync(filePath);
            } catch (error) {
              console.log(`Failed to delete ${filePath}`);
              console.log(error);
            }
          }
        }

        process.exit(0);
      },
    );
}
