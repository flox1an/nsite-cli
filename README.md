# nsite-cli

This command line tool allows you to publish a static website on NOSTR in a anonymous and censorship resistant way. 
* The website file listings are published as events (kind 34128) on NOSTR relays.
* The binary files are uploaded to a blossom servers.
* All data is signed with your private key, so it can not be altered by anyone else.

## Usage
There are two ways to use this tool.

1. When you run `nsite-cli` without any subcommand, it will start an interactive dialog to set up a new project. Here you can also create a new private key (nsec) for signing, add custom relays and blossom servers.

2. You can specify all settings on the command line or environment variables and use the `upload` command to upload a website.
    ```
    nsite-cli upload \
    --relays 'wss://nos.lol,wss://relay.primal.net,wss://relay.nostr.band,wss://relay.damus.io' \
    --servers 'https://cdn.satellite.earth,https://files.v0l.io' \
    --privatekey <some secret nsec> \
    www
    ```

## Environment variables

Setup your NOSTR relays through the `NOSTR_RELAYS` environment variable:

```
export NOSTR_RELAYS=wss://nos.lol,wss://relay.primal.net,wss://relay.nostr.band,wss://relay.damus.io
```

The `BLOSSOM_SERVERS` can be used to specify the blossom servers:
```
export BLOSSOM_SERVERS=https://media-server.slidestr.net/,https://files.v0l.io/
```

Set a `NOSTR_PRIVATE_KEY` that will be used to publish events (nsec or hex string) can be set as follows:
```
export NOSTR_PRIVATE_KEY=<nsec or hex nostr private key>
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
