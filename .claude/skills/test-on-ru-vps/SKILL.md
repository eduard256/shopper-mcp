---
name: test-on-ru-vps
description: Test scripts and code before shipping not only locally but also on a real VPS in Russia (datacenter IP, Linux, Docker). Use when you need to check how a site (Ozon, WB, Avito, etc.) reacts to a browser running from a server IP.
---

# Test on a real VPS in Russia

Server: VPS in Russia, Linux amd64, datacenter IP. Production sites run on it.
Connect: `ssh ru-vps` (alias in `~/.ssh/config`). No alias — ask the user for the address.

## Rules
- Touch nothing but the `fp-test` container.
- About 1 GB of free memory, no swap: one run at a time.
- Start from a variant that passes and remove one detail at a time. Stop at the first captcha: a series of failures flags the IP.
- After the test, `docker stop fp-test`. Do not remove it unless asked.

## The fp-test container
Usually stopped, no autostart. `node:24-trixie-slim` inside, 700 MB memory limit, 256 MB `/dev/shm`.
`/w/node_modules` holds patchright of the version in `package.json`, plus Chromium.

No container — create it (the server downloads everything):

    ssh ru-vps 'docker run -d --name fp-test --memory=700m --memory-swap=700m --shm-size=256m --cpus=1.5 \
      --entrypoint sleep node:24-trixie-slim infinity &&
      docker exec fp-test sh -c "mkdir -p /w && cd /w && npm init -y && npm i patchright@<version> && npx patchright install --with-deps chromium --no-shell"'

## A standalone script (main way)
Write a script for the task:
- loads patchright from `/w/node_modules` via `createRequire`;
- launches the browser as `src/shared/browser.ts` does, profile in a temp dir;
- reads the variant's parameters from env vars, so they change without editing the script;
- prints JSON to stdout: navigation statuses, title, start of the page text, and whatever is being checked (`navigator.*`, request headers).

Run: the script goes in via stdin, JSON comes back via stdout.

    ssh ru-vps "docker start fp-test >/dev/null && cat > /tmp/t.mjs && docker cp /tmp/t.mjs fp-test:/w/t.mjs && rm /tmp/t.mjs &&
      docker exec -e VAR=value fp-test sh -c 'cd /w && node t.mjs'" < script.mjs > result.json
    ssh ru-vps 'docker stop fp-test'

## Project code
Build locally and send as an archive:

    npm run build
    tar czf - dist package.json package-lock.json | ssh ru-vps \
      "docker start fp-test >/dev/null && docker exec -i fp-test sh -c 'rm -rf /app/dist && mkdir -p /app && tar xzf - -C /app'"

Install dependencies only when `package-lock.json` changes:

    ssh ru-vps "docker exec fp-test sh -c 'cd /app && npm ci --omit=dev'"

Run: MCP over stdio, JSON-RPC fed via stdin, as in `scripts/smoke.mjs`:

    ssh ru-vps "docker exec -i -e SHOPPER_IN_CONTAINER=true -e SHOPPER_PROFILE_DIR=/tmp/profile \
      -e PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright fp-test node /app/dist/index.js" < requests.jsonl

After the test, `docker stop fp-test`.
