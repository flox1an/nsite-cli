# nsite-cli

## Setup

Setup your NOSTR relays through the `NOSTR_RELAYS` environment variable.

```
export NOSTR_RELAYS=wss://nos.lol,wss://relay.primal.net,wss://relay.nostr.band,wss://relay.damus.io
```

Then set the `BLOSSOM_SERVERS` to be used:
```
export BLOSSOM_SERVERS=https://media-server.slidestr.net/,https://files.v0l.io/
```

Set a NOSTR private key that will be used to publish events:
```
export NOSTR_PRIVATE_KEY=<hex nostr private key>
```

Once you have built the cli app, you can also use 
```
nsite-cli generate     
```
to create a newly generated private key.

To enable debug logging, set the `DEBUG` environment variable to `nsite*`
```
export DEBUG=nsite*
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

