# Rules for anyone writing code here

These rules apply to every agent and every person opening a pull request.

## Scope

1. Build only what your task card in `docs/build-plan.md` lists. No extra files, endpoints, helpers, options, abstractions, config, scripts, docs or dependencies.
2. If the card and `docs/architecture.md` disagree, or something you need is not written down, stop. Do not guess and do not invent product behaviour. Write the question in the pull request description under "Questions" and leave that part unbuilt.
3. Do not touch files outside the paths your card names, except `package-lock.json` when you add a dependency the card lists.
4. Do not change the root `package.json`, `tsconfig.base.json`, `AGENTS.md`, `CLAUDE.md` or anything in `docs/` unless your card says to.
5. Do not refactor, rename or reformat code you did not write in this task.

## Code

1. TypeScript only, strict mode, through `tsconfig.base.json`. No `any`, no `@ts-ignore`, no `as unknown as`.
2. ES modules. Import local files with their `.ts` extension.
3. Packages ship TypeScript source: `"main": "src/index.ts"`. There is no build step.
4. Use only the dependencies and exact versions your card lists. Pin exact versions (no `^` or `~`).
5. No network calls in tests. No real secrets anywhere. No `console.log` left in source.
6. Money is integer credits. Never use floats for balances.
7. Timestamps are integer Unix milliseconds.
8. The server never stores readable note content. Never add a column, key or log line that holds transcript, note or page text.

## Tests

1. Every exported function has tests for the normal case and for each error case the card lists.
2. Tests live in the package's `test/` folder and run with `vitest run` (unless the card says `node --test`).
3. Before you open the pull request, run from the repo root and paste the last lines of each into the description:
   - `npm install`
   - `npm run typecheck`
   - `npm test`
   All three must pass. If one fails and you cannot fix it inside your card's scope, say so in the description. Never skip or delete a test to make it pass.

## Git and pull requests

1. One card, one branch, one pull request. Branch name is on the card.
2. Small commits with plain messages. Do not push to `main`.
3. Pull request title: the card title. Description sections: "What this adds", "How it was checked" (command output), "Not done / questions".
4. Do not merge your own pull request.
