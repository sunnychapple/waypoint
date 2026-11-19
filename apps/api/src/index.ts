import { createApp } from "./app.ts";

export { Wallet } from "./wallet/object.ts";

export default createApp({
  fetchJwks: (url) => fetch(url).then((r) => r.json()),
  now: Date.now,
  newId: () => crypto.randomUUID(),
});
