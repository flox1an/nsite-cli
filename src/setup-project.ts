import { bytesToHex } from "@noble/hashes/utils";
import { NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import debug from "debug";
import { ProjectData, readProjectFile, writeProjectFile } from "./config.js";
import { nip19 } from "nostr-tools";
import inquirer from "inquirer";
import autocomplete from "inquirer-autocomplete-standalone";

const log = debug("setup-project");

interface UrlOption {
  name: string;
  value: string;
}

const popularRelays = [
  "wss://nostr.cercatrova.me",
  "wss://relay.primal.net",
  "wss://relay.wellorder.net",
  "wss://nos.lol",
  "wss://nostr-pub.wellorder.net",
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
];

const popularBlossomServers = [
  "https://blossom.primal.net",
  "https://cdn.nostrcheck.me",
  "https://cdn.satellite.earth",
  "https://files.v0l.io",
];

async function selectUrls(promptMessage: string, initialUrls: string[]): Promise<string[]> {
  let urls: string[] = [...initialUrls]; // Clone the initial URLs list
  let finalSelection: string[] = [];
  let addingNewUrl = true;

  while (addingNewUrl) {
    const selectedUrl = await autocomplete<string>({
      message: promptMessage,
      source: (input: string | undefined) => {
        input = input || "";
        const filteredUrls = urls
          .filter((url) => !finalSelection.includes(url))
          .filter((url) => url.toLowerCase().includes(input.toLowerCase()));
        // If input doesn't match any URL, allow it to be the new URL
        return Promise.resolve([...filteredUrls, input].map((s) => ({ value: s, name: s.length == 0 ? "Done." : s })));
      },

      validate: (input: string) => {
        const urlPattern = new RegExp(
          "^(https?:\\/\\/|wss?:\\/\\/)?" + // protocol (http, https, ws, wss)
            "((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|" + // domain name
            "((\\d{1,3}\\.){3}\\d{1,3}))" + // OR ip (v4) address
            "(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*" + // port and path
            "(\\?[;&a-z\\d%_.~+=-]*)?" + // query string
            "(\\#[-a-z\\d_]*)?$",
          "i",
        );
        return input.trim() == "" || urlPattern.test(input) || "Please enter a valid URL (http, https, ws, wss).";
      },
    });

    // Add the selected or entered URL to the final selection
    if (selectedUrl.trim().length > 0) {
      finalSelection.push(selectedUrl.trim());
    }

    addingNewUrl = selectedUrl.trim().length !== 0;
  }

  return finalSelection;
}

async function onboarding(): Promise<void> {
  // TODO add web site name, so we can pblish it to the npubs profile

  let privateKey: string;
  const { existingKey } = await inquirer.prompt([
    {
      type: "input",
      name: "existingKey",
      message: "1. Existing NOSTR private key (nsec/hex) (Enter to create a NEW one):",
    },
  ]);

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

  const { projectName }: { projectName: string } = await inquirer.prompt({
    type: "input",
    name: "projectName",
    message: "2. Web site or project name:",
  });
  const { projectAbout }: { projectAbout: string } = await inquirer.prompt({
    type: "input",
    name: "projectAbout",
    message: "3. Web site or project description:",
  });

  const relays = await selectUrls("4. NOSTR relay URLs:", popularRelays);

  const servers = await selectUrls("5. Blossom server URLs:", popularBlossomServers);

  const projectData: ProjectData = {
    privateKey,
    relays,
    servers: servers,
    profile: {
      name: projectName,
      about: projectAbout,
    },
    publishProfile: projectName.length > 0 || projectAbout.length > 0,
    publishServerList: true,
    publishRelayList: true,
  };
  writeProjectFile(projectData);
}

export async function setupProject(): Promise<ProjectData> {
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
