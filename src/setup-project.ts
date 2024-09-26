import { bytesToHex } from "@noble/hashes/utils";
import { NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import debug from "debug";
import { createInterface } from "readline/promises";
import { ProjectData, readProjectFile, writeProjectFile } from "./config.js";
import { nip19 } from "nostr-tools";

const log = debug("setup-project");

async function onboarding(): Promise<void> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let privateKey: string;
  const existingKey = await readline.question(
    "\n1. Existing NOSTR private key (nsec/hex) or press Enter to create a NEW one:\n",
  );

  if (existingKey.trim()) {
    if (existingKey.startsWith("nsec1")) {
      privateKey = bytesToHex(nip19.decode(existingKey).data as Uint8Array);
    } else {
      privateKey = existingKey.trim();
    }

    log("Using provided private key.");
  } else {
    const signer = NDKPrivateKeySigner.generate();
    privateKey = signer.privateKey!;
    log("Generated new private key.");
  }

  try {
    const signer = new NDKPrivateKeySigner(privateKey);
    const user = await signer.user();
    log("Using npub: " + user.npub);
  } catch (e) {
    log("Invalid private key!");
    process.exit(1);
  }

  const askForList = async (prompt: string): Promise<string[]> => {
    console.log(prompt);
    const list: string[] = [];
    while (true) {
      const input = await readline.question("");
      if (input.trim() === "") break;
      list.push(input.trim());
    }
    return list;
  };

  const relays = await askForList("\n2. Enter multiple NOSTR relay URLs (e.g. wss://nos.lol) Press Enter to finish:");
  const servers = await askForList(
    "3. Enter multiple blossom server URLs (e.g. https://cdn.satellite.earth) Press Enter to finish:",
  );

  readline.close();

  const projectData: ProjectData = {
    privateKey,
    relays,
    servers: servers,
    publishServerList: true,
    publishRelayList: true,
  };
  writeProjectFile(projectData);
}

export async function setupProject() {
  let projectData = readProjectFile();
  if (!projectData) {
    console.log("nsite-cli: No existing project configuration found. Setting up a new one:");
    await onboarding();
    projectData = readProjectFile();
  }

  if (!projectData || !projectData.privateKey) {
    console.error("Project data not found. Use nsite-cli genrate to set up a new project.");
    process.exit(1);
  }

  return projectData;
}
