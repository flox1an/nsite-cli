# nsite-cli

This command line tool allows you to publish a static website on NOSTR in a anonymous and censorship resistant way.

- The website file listings are published as events (`Kind 34128`) on NOSTR relays.
- The binary files are uploaded to a blossom server ( https://github.com/hzrd149/blossom )
- All data is signed with your private key, so it can not be altered by anyone else.

## Usage

There are two ways to use this tool.

1. When you run `npx nsite-cli` without any subcommand, it will start an interactive dialog to set up a new project. Here you can also create a new private key (nsec) for signing, add custom relays and blossom servers. All settings will be saved in a `.nsite/project.json` file in the current working directory.

2. You can specify all settings on the command line or environment variables and use the `upload` command to upload a website.
   ```
   npx nsite-cli upload \
   --relays 'wss://nos.lol,wss://relay.primal.net,wss://relay.nostr.band,wss://relay.damus.io' \
   --servers 'https://cdn.satellite.earth,https://nostr.download' \
   --privatekey <some secret nsec> \
   www
   ```

## Commands

### Upload

Upload a folder to NOSTR and the configured blossom servers:

```
npx nsite-cli upload <folder>
```

### Download

Download a folder from NOSTR and the configured blossom servers:

```
npx nsite-cli download ./targetfolder npub1kjd4h3scfgzqmxn509a2fzuemps379rxnk7lkfh39jme3jdnfg
```

Download currently only works with a given public key (npub) and not with the private key or project configuratiom.

### List

List all uploaded files of a specific public user (npub):

```
npx nsite-cli ls npub1kjd4h3scfgzqmxn509a2fzuemps379rxnk7lkfh39jme3jdnfg
```

or list all uploaded files for the current private key (from the .nsite/project.json file):

```
npx nsite-cli ls ./targetfolder
```

## Environment variables

Setup your NOSTR relays through the `NOSTR_RELAYS` environment variable:

```
export NOSTR_RELAYS=wss://nos.lol,wss://relay.primal.net,wss://relay.nostr.band,wss://relay.damus.io
```

The `BLOSSOM_SERVERS` can be used to specify the blossom servers:

```
export BLOSSOM_SERVERS=https://media-server.slidestr.net/,https://nostr.download/
```

Set a `NOSTR_PRIVATE_KEY` that will be used to publish events (nsec or hex string) can be set as follows:

```
export NOSTR_PRIVATE_KEY=<nsec or hex nostr private key>
```


## Dynamic web app with browser based routing (e.g. React Browser Router)

For deep linking into web apps that use browser based routing there needs to be a way to redirect 
requests to the root `/index.html` to start the web apps. **nsite** solves this by using a `/404.html`. You can either 
upload a custom `/404.html` file or use the `--fallback=/index.html` option to "redirect" to a specific html file. 
This instructs `nsite-cli` to upload a copy of the specified fallback file as  `/404.html`.
```
npx nsite-cli upload dist --fallback=/index.html

```
Another way is to use the fallback option in the project config.
```json
{
  "privateKey": "xxxxxxxxxx",
  "relays": [
    ...
  ],
  "servers": [
    ...
  ],
  "fallback": "/index.html"
}

```


## Connecting to Tor and I2P relays

nsite-cli supports `ALL_PROXY` and other proxy env variables [here](https://www.npmjs.com/package/proxy-from-env#environment-variables)

Install Tor ([Documentation](https://community.torproject.org/onion-services/setup/install/)) and I2Pd ([Documentation](https://i2pd.readthedocs.io/en/latest/user-guide/install/))

Create a proxy.pac file

```txt
// SPDX-License-Identifier: CC0-1.0

function FindProxyForURL(url, host)
{
  if (shExpMatch(host, "*.i2p"))
  {
    return "PROXY 127.0.0.1:4444; SOCKS5 127.0.0.1:4447";
  }
  if (shExpMatch(host, "*.onion"))
  {
    return "SOCKS5 127.0.0.1:9050";
  }
  return "DIRECT";
}
```

Start the command with `PAC_PROXY` variable

```sh
PAC_PROXY=file://$(pwd)/proxy.pac npx nsite-cli .
```

## Troubleshooting

To enable debug logging, set the `DEBUG` environment variable to `nsite*` or even `*` to also see `ndk:*` logs

```
export DEBUG=nsite*

OR

export DEBUG=*
```

## Build

```
npm i
npm run build

bun i
bun run build
```

## Install or Run

By running

```
npm link
```

the `nsite-cli` command can be installed to be run from command line from anywhere you like.

Otherwise it can also be run from source using `bun`

```
bun run src/cli.ts upload ./www
```

Or from the built javascript files using node

```
node dist/cli.ts upload ./www
```
