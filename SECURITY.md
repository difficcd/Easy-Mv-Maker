# Security

## Reporting a vulnerability

Do not open a public issue for a security problem. Use GitHub's **Report a vulnerability**
button on the Security tab, or email leeow1214@gmail.com. Either way it reaches one person, the
maintainer, and a first reply should come within a week.

Please say what an attacker gets out of it, not only that something is possible - that is what
decides how fast it is fixed.

## What is in scope

The app runs in the browser and the API server runs on the user's own machine, so most of the
attack surface is local. Worth reporting:

- Anything that lets an opened `.emv` file or an imported image or video run code, read files it
  should not, or reach the network.
- Path traversal or arbitrary file access through the local API server (`server/`), which serves
  project files and assets.
- A dependency with a known vulnerability that this project actually reaches - Dependabot is on,
  so a report is most useful when it explains the path through *this* code.

## What is not

The local API server binds to `127.0.0.1` and has no authentication, by design: it is the
user's own machine and their own files. The same is true of the browser holding projects in
IndexedDB.

**In the default dev workflow that reaches further than this machine, and that is known.**
`npm run dev` serves on the LAN so a tablet on the same Wi-Fi can connect, and it proxies `/api`
to the loopback server - so anyone on the same network can read, overwrite and delete projects
through `:5175/api`. The dev server prints a warning saying so when it starts, and `MV_LAN=0`
keeps it on this machine for a network you do not trust. Until 2026-10-21 this page said only
"anyone on your machine", which was not the configuration the app actually ran under; an
authenticated mode is not built. A report that this exposure exists is not a finding - a way
through it *with* `MV_LAN=0`, or from outside the local network, is.

Server errors do not carry internal detail to the client: a failed request gets a sentence for a
known error code (a full disk, a permission) or a generic one, and the full error goes to the
server's own log.

`MV_API_HOST` can bind it to another interface - that is for the tablet-over-a-proxy workflow
and it is documented as such. Exposing it to a network on purpose and then reading someone
else's projects over that network is the documented consequence, not a finding.

## Supported versions

`main` only. There are no release branches to back-port to.
