# Waypoint architecture

Source: design boards U1 to U9 (16 Nov 2026). This file is the spec for code. If code and this file disagree, raise it in the pull request; do not quietly pick one.

## 1. The system

Three zones.

- **The device (trust boundary).** Notes are readable only here. Audio capture, speech to text, page reading, flashcards, quizzes, search and the voices for audio overviews all run on the iPhone and cost nothing to serve. Keys live in the Secure Enclave. SQLite holds the real data and the local search index.
- **Cloudflare (our account).** Holds locked (end-to-end encrypted) copies for sync and sharing, and runs the cloud tasks a person pays credits for.
- **Outside services.** Clerk (sign-in, sessions), Apple (StoreKit 2 purchases, server notices, push), a web search API, Zephyr Cloud (over-the-air bundles).

Sync and sharing cross the trust boundary only as locked data. A cloud task crosses it with only the text the person chose to send (for an explanation, about 54 seconds of transcript). Audio leaves the phone only for the optional second transcript. There is no Watch app and no CarPlay.

### Cloudflare components

| Component | Job |
|---|---|
| API Worker | The whole REST API. Checks the Clerk session, routes, quotes credits, rate limits, streams answers. |
| Group room (Durable Object, one per group) | Ordered log of locked changes, live sockets, who is viewing. |
| Wallet (Durable Object, one per billing account) | Balance, holds, ledger. One writer, so balances are never raced. |
| D1 | The directory: accounts, devices, groups, memberships, invites, links, purchases, jobs, activity. No note content. |
| R2 | Locked note snapshots and media, sealed task results, shared-link data, the voice pack download. |
| KV | Price table, model routes, router config, feature flags, minimum native version, voice pack pointer. Also Zephyr's bundle store. |
| Queues | Push fan-out, usage events, App Store notices, cleanup. |
| Workflows | Long jobs: web research, overview scripts, the second transcript, reading a link. |
| Workers AI | Every cloud model call by default: open models in three tiers, the Clef router, Whisper for the second transcript, MeloTTS as the fallback voice. |
| AI Gateway | Every model call goes through it: per-account rate limits, logging off per request, zero-retention switch for outside models. |
| Browser Run | Fetches a page and returns clean text, for pasted links and research. |
| Workers static assets | The shared-link web viewer. |
| Analytics Engine | Cost and usage per task type and route, with no content. |
| Turnstile, rate limits | Protect shared links and passcode attempts. |
| Secrets Store | Search, Apple and push keys. |

Deliberately not used: Containers, Vectorize, Stream, Images, Hyperdrive. Cloudflare has no Apple push product, so a queue consumer calls Apple directly.

## 2. What runs where

| Job | Where | Price to the person |
|---|---|---|
| Transcript | iPhone (Apple on-device speech, offline) | Free |
| Second transcript, opt-in | Cloud (Whisper large v3 turbo). Off by default, per session or always. The app shows which words changed. | 1 credit per minute |
| Page reading, photo text | iPhone (Apple Vision) | Free |
| Flashcards, quiz, Help me with a problem | iPhone (on-device model) | Free |
| Search and the search index | iPhone. The index never leaves the device. | Free |
| Explain, more detail, double-check | Cloud, open models on Workers AI | 1 to 4 credits |
| Research the web | Cloud: search API, Browser Run, open models | 15 to 125 credits |
| Audio overview: the script | Cloud, strong model writes a two-host script | 40 credits |
| Audio overview: the voices | iPhone: Kokoro-82M (Core ML, Neural Engine, iOS 18+). Downloaded on first use; Apple system voices until then. | Free |
| Voices on an older phone | Cloud fallback: MeloTTS on Workers AI | +2 credits |
| Video overview | Both: strong model writes the slides; narration and assembly on the iPhone. No cloud renderer. | 50 credits |
| Diagram, mini app, practice set | Cloud, open models | 8 to 40 credits |

### What ships how

| Part | Built with | Ships through |
|---|---|---|
| Host shell (navigation, sign-in, update loader) | React Native, Hermes, Metro, `@module-federation/metro` | App Store |
| Feature bundles: Capture, Explain, Study, Share, Settings, Plans | Metro remotes built with `zephyr-metro-plugin` | Over the air. Checked by SHA-256, cached by `zephyr-native-cache`, applied on the next cold start, never during a recording. |
| Native modules: audio capture and background recording, speech to text, on-device voices, on-device model, crypto and key storage, SQLite with vector index, StoreKit 2, camera with page detection | Swift | App Store |
| System targets: widgets, Live Activity and Dynamic Island, share extension (shared state through an App Group) | Swift, SwiftUI | App Store |
| Web viewer | Static web app | Workers static assets, any time |
| Voice pack | Core ML model file | Fetched from R2 on first use, checked by hash. Not in the app binary. |

Release rules: one Zephyr environment per native version (each store build reads its own tag, for example `ios-1.4`). Release to an internal tag, check it, then move the production tag. Rolling back moves the tag one version back. New features go through store builds; over-the-air is for fixes, copy and iteration.

## 3. Flows

Every paid flow follows one money pattern: **quote, hold, run, settle at the real cost, never above the quote.**

1. **Explain a word (instant, streamed).** App `POST /v1/tasks/explain` with the word and about 54 s of transcript. API asks the wallet to hold 1 credit. The router (Clef-flash) scores the request and picks light, standard or strong. The model call goes through AI Gateway with logging off, streaming. The answer streams back through the Worker. API settles at the real cost. A usage event goes to a queue (task, size, route, no content). Nothing is written to storage. If the model fails, the hold is released and the app offers Try again or Ask later.
2. **Audio overview.** App `POST /v1/jobs` type `overview_script` with the transcript text. Hold 40 credits. Start a Workflow; the app gets a job id. A strong model writes the two-host script. The script is stored in R2 sealed to the requesting device, 7-day life. Settle the hold. Queue sends push "your overview is ready". The app fetches the script, speaks it with two on-device voices and saves the audio locally, then `DELETE`s the result. Research and video slides use the same shape.
3. **Second transcript (opt-in).** App `POST /v1/jobs` type `retranscribe`, quoted at 1 credit per minute. App uploads the audio for this job with a signed URL to R2 `tmp/audio/{job}`. Workflow runs Whisper large v3 turbo in chunks, deletes the audio, stores the text sealed to the device, settles. The app compares with the on-device transcript and marks changed words. This is the only flow where audio leaves the phone; it is held unlocked only for the length of the job. The sheet that turns it on must say so.
4. **Sync and sharing.** Device A locks the change with the group key, opens the socket `/v1/groups/:id/sync`, appends the locked change. The room gives it the next sequence number and broadcasts to connected devices; offline ones get a push. Device B fetches changes after its last number. Locked media is uploaded to R2 with a signed URL, paid plans only. The room orders changes but cannot read them. Removing a member bumps the key version; only remaining devices get the new wrapped key.
5. **Purchases and credits.** StoreKit 2 purchase on the device; app `POST /v1/purchases/apple` with the signed transaction. API verifies Apple's signature, wallet grants credits once per transaction id. Apple server notices (renewal, refund, revoke) arrive at `POST /webhooks/apple`; the wallet adds the monthly allowance or claws back. A family member who gets Own it through Family Sharing gets access only; the 2,000 credits go to the buyer, once.
6. **Releasing an update.** CI builds feature bundles and uploads to Zephyr, which stores an immutable version in our Cloudflare account. CI moves the internal tag, checks, then moves the tag for the native version. At launch the app asks what its tag points to, verifies SHA-256, caches, uses it on the next cold start. Roll back by moving the tag.
7. **Adding a device.** New device `POST /v1/devices` with its public keys. API pushes to an old device. The person compares a 6-digit code on both and approves; old device `POST /v1/devices/:id/approve` with group keys wrapped for the new device. Push "approved"; the new device fetches wrapped keys, then syncs. Signing in proves who you are; it never unlocks notes. Without a trusted device, the 12-word recovery key unwraps the same keys.
8. **Choosing a model per task (before prices are fixed).** Test set of public lecture clips and textbook pages, never people's notes. Run each task on 3 to 5 candidate models per tier. Clef grades each answer (correct, grounded in the source, right reading level). People check a sample by hand. Write the cheapest passing model to KV as the route. Recompute credits from measured cost and publish a new price table version. Repeat monthly and whenever Workers AI adds or reprices a model.

## 4. API

One versioned REST surface on the API Worker plus one socket per group. Every request carries the Clerk session. Requests that change keys, devices or money are also signed by the device key.

| Area | Endpoints | Backed by |
|---|---|---|
| Config | `GET /v1/config` | KV: price table, routes version, flags, minimum native version, voice pack |
| Devices and keys | `POST /v1/devices`, `GET /v1/devices`, `POST /v1/devices/:id/approve`, `DELETE /v1/devices/:id`, `PUT /v1/recovery`, `POST /v1/push-tokens` | D1 |
| Groups | `POST /v1/groups`, `GET /v1/groups`, `POST /v1/groups/:id/invites`, `POST /v1/invites/:token/accept`, `DELETE /v1/groups/:id/members/:user`, `POST /v1/groups/:id/keys` | D1, group room |
| Sync | `GET /v1/groups/:id/sync` (socket), `GET /v1/groups/:id/changes?after=`, `POST /v1/groups/:id/changes`, `POST /v1/blobs` (returns a signed upload URL), `GET /v1/blobs/:id` | Group room, R2 |
| Shared links | `POST /v1/links`, `DELETE /v1/links/:id`, `GET /l/:id` (viewer page), `GET /v1/links/:id/data` | D1, R2, static assets |
| Instant tasks | `POST /v1/tasks/quote`, `POST /v1/tasks/explain` (stream), `POST /v1/tasks/more-detail` (stream), `POST /v1/tasks/double-check`, `POST /v1/tasks/read-link` | Wallet, router, Workers AI through AI Gateway, Browser Run |
| Long jobs | `POST /v1/jobs` type `research \| overview_script \| video_slides \| diagram \| mini_app \| practice \| retranscribe`, `GET /v1/jobs/:id`, `GET /v1/jobs/:id/events` (stream), `GET /v1/jobs/:id/result`, `DELETE /v1/jobs/:id` | Workflows, wallet, R2 |
| Wallet | `GET /v1/wallet` (balance, plan, entitlements), `GET /v1/wallet/ledger` | Wallet |
| Privacy | `PUT /v1/settings/zero-retention` (Plus only) | D1 |
| Purchases | `POST /v1/purchases/apple`, `POST /webhooks/apple`, `POST /webhooks/clerk` | Wallet, D1, Queues |
| Cloud activity | `GET /v1/activity` | D1: task, size, credits, route, time. The text sent is kept only on the device. |

Rules every endpoint follows:

- **Idempotency-Key on every write.** A retry on a bad connection never charges twice or writes twice.
- **402 when credits run out.** The reply carries the shortfall. The app shows Out of credits and retries the same request after a purchase.
- **One error shape:** `code`, `message`, `retry_after`.
- **No readable notes outside a task.** The server never accepts readable note content except inside a task request.

A quote:

```
POST /v1/tasks/quote
{ "task": "overview_script", "minutes": 4 }

200
{ "credits": 40, "price_table": "2026-11-16.2", "retention": "standard", "balance_after": 1960, "expires_in": 300 }
```

The price is fixed per task, whichever route the router picks.

## 5. Data

### D1, the directory

```
users        (id, clerk_id, created_at, plan, billing_account_id, zero_retention)
entitlements (user_id, product, source -- purchase | family_share, media_cap_gb, granted_at, ended_at)
devices      (id, user_id, name, platform, sign_pub, box_pub, can_approve, added_at, removed_at)
recovery     (user_id, wrapped_account_key, verified_at)
groups       (id, kind, name_locked, key_version, created_by)
memberships  (group_id, user_id, role, starts_at, ends_at, history_from, left_at)
key_envelopes(group_id, key_version, device_id, wrapped_key)
invites      (token_hash, group_id, role, expires_at, accepted_by)
links        (id, group_id, blob_key, passcode_hash, expires_at, revoked_at, views)
purchases    (transaction_id PK, original_id, billing_account_id, product_id, kind, status, purchased_at)
jobs         (id, user_id, type, state, quoted, spent, route, result_key, created_at, expires_at)
activity     (id, user_id, task, bytes_sent, credits, route, retention, at)
```

### Group room (one Durable Object per group, SQLite storage)

```
changes  (seq PK, device_id, key_version, kind, locked_bytes, blob_key, at)
cursors  (device_id PK, last_seq, seen_at)
presence (device_id, user_id, since)   -- memory only
```

### Wallet (one Durable Object per billing account, SQLite storage)

```
balances (bucket PK -- monthly | purchased, credits, resets_at)
holds    (id PK, user_id, task, credits, expires_at)
ledger   (id PK, at, user_id, kind -- grant | hold | settle | release | refund | clawback | reset, bucket, credits, ref)
```

Monthly credits are spent first, then purchased ones. The ledger only ever gets new rows, so the balance can always be rebuilt from it. A `family_share` entitlement creates no wallet grant.

### KV keys

```
config:prices:{version}   task -> credits
config:routes:{version}   task -> tier -> model id, retention class
config:router             questions and thresholds
config:flags              feature switches
config:min-native         oldest supported build
config:voice-pack         url, sha256, size
```

### R2 objects

```
groups/{group}/snap/{seq}    locked snapshot
groups/{group}/media/{blob}  locked audio, photo
results/{job}                sealed to one device, deleted after 7 days
links/{link}/data            locked for the viewer
tmp/audio/{job}              second transcript only, deleted when the job ends
packs/voices/{version}       on-device voice model
```

### On the device (SQLite)

```
spaces, sessions
segments     (session, t_start, t_end, text, source -- device | cloud)
captures     (session, kind, t, file, found_text)
flags        (session, t, question, state)
explanations (session, t, term, thread, saved)
terms, cards, reviews
overviews    (session, script, audio_file, voices)
search_index (vector per chunk, model version)
outbox       (locked changes waiting to send)
sent_log     (what each cloud task sent)
```

A set of pages from Snap pages is a session with captures and no audio.

Proposed cryptography, **to be reviewed by a security owner before it is built**: a signing key and an encryption key per device, a symmetric key per group and key version wrapped for each device, authenticated encryption for every change and file.

## 6. Models and routing

Three tiers of open models on Workers AI. A decision model picks the tier per request; a test (flow 8) picks the model per tier.

| Tier | Used for | Candidates (price per million tokens in / out) | Planning price |
|---|---|---|---|
| Light | Explain. Reading pages during research. | GLM 4.7 Flash $0.06/$0.40, Gemma 4 26B $0.10/$0.30, Qwen3 30B $0.05/$0.34, GLM 5.3 Flash $0.15/$0.50 | $0.06 / $0.40 |
| Standard | More detail. Research answers. Practice sets. | DeepSeek V4.1 Flash $0.30/$1.20, GPT-OSS 120B $0.35/$0.75, Llama 4 Scout $0.27/$0.85 | $0.30 / $1.20 |
| Strong | Overview scripts, slides, diagrams, mini apps, double-check. | Kimi K2.6 $0.95/$4.00, DeepSeek V4 Pro $1.32/$3.96, GLM 5.3 $1.40/$4.40, Kimi K2.5 $0.60/$3.00 | $0.95 / $4.00 |

No model's answer quality has been tested yet.

### The router

Clef-flash (Workers AI) to start; Jev can be swapped in through the same API. On each request the router gets:

```
state
  task, the word or question, the text sent, grade level if known

questions
  difficulty   score    1 to 5
  needs_web    yes / no
  subject      choice   math | science | language | history | other
  unsafe       yes / no

route
  difficulty 1 to 2        -> light
  difficulty 3 to 4        -> standard
  difficulty 5, or unsure  -> strong
  needs_web                -> offer Research the web
  zero_retention is on     -> zero-retention routes only
```

### What is kept, by route

| Route | Who gets it | Line on the screen |
|---|---|---|
| On this iPhone | Everyone | On this iPhone |
| Standard cloud | Everyone | Sent for this task only |
| Zero-retention cloud (Plus only) | Plus | Not stored in the cloud |

Zero-retention routes are only models with a written zero-retention commitment: models Cloudflare hosts itself, or outside models through AI Gateway with zero retention on. Never route student content to a lab's own API. **Open:** which catalog models Cloudflare hosts itself is not confirmed, so no route is marked zero-retention yet.

## 7. Credits

Pricing rule: one credit covers $0.0005 of provider cost. Task price in credits = estimated cost divided by $0.0005, rounded up, minimum 1, quoted at the 90th-percentile cost. The price table is versioned in KV; current version `2026-11-16.2`:

| Price key | Credits |
|---|---|
| `explain` | 1 |
| `double_check` | 4 |
| `more_detail` | 3 |
| `research_quick` | 15 |
| `research_standard` | 45 |
| `research_deep` | 125 |
| `overview_script` | 40 |
| `video_slides` | 50 |
| `diagram` | 18 |
| `mini_app` | 40 |
| `practice` | 8 |
| `retranscribe` | 1 per audio minute |
| `fallback_voice` | +2 on top of an overview |

Products: free with 25 starter credits; Own it once (2,000 credits once, to the buyer only); Plus monthly or yearly (2,000 credits a month as a monthly allowance); credit packs of 1,000, 5,000 and 20,000. Purchased credits never expire. Free syncs text only; audio and photos sync on paid plans. Included synced media is capped at 3 GB per person.
