# Mobile cards: the iPhone app (Expo)

This file expands the "Mobile and web (separate track)" table in `docs/build-plan.md`. It has four parts:

1. Setup, plus what the owner does tonight once Xcode is installed.
2. Full cards for **stage 1**: the app works on one iPhone, with the free on-device features and no server except sign-in.
3. A one-line outline of the mobile cards for stages 2 to 4.
4. Open questions for the owner.

Every card follows `AGENTS.md`, plus the extra rules in "Rules for every mobile card" below. The spec is `docs/architecture.md`. Screens refer to the design boards by their ids (A1, C1, T4 and so on). The PNG exports are in the design-review folder; v2 is current. If a card and the spec disagree, or something is not written down, stop and ask in the pull request.

Stages used here:

| Stage | What works |
|---|---|
| 1 | One iPhone. Sign in. Record with a live transcript, snap pages, flashcards, quiz, help with a problem, search, settings. Everything is on the device. |
| 2 | Talks to the API: typed client, device keys and registering this iPhone, credits and purchases, Explain, questions for later, second transcript, research. |
| 3 | Audio and video overviews and the on-device voices. |
| 4 | Sync, sharing, adding more devices, the recovery key, over-the-air bundles, widgets, Live Activity, share extension. |

Where these cards sit next to the server cards is "Build order" in `docs/build-plan.md`. Every paid request (tasks, jobs, purchases) must be signed by an approved device (`docs/security.md` section 7; server card S1E), so the device keys module and registering the first device are in stage 2, before anything that spends or buys credits.

---

## 0. Tonight: getting the Mac ready for iOS builds

**Read this first. Installing Xcode on this Mac as it is now is not enough.**

The Mac runs macOS 15.7.3 (Sequoia). Expo SDK 58 needs Xcode 26.4 or later, and Xcode 26.4 needs macOS Tahoe 26.2 or later. The newest Xcode that runs on Sequoia is 26.3. The current Xcode is 27.2, which needs macOS Tahoe 26.6. Apple will also require apps to be built with the iOS 27 SDK from April 2027.

Steps, in order:

1. Upgrade macOS to Tahoe 26.6 or later (System Settings › General › Software Update).
2. Install Xcode 27.2. Then run:
   ```sh
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   sudo xcodebuild -license accept
   xcodebuild -runFirstLaunch
   xcodebuild -downloadPlatform iOS        # iOS 27 simulator runtime
   xcrun simctl list runtimes              # check: an iOS 27.x runtime is listed
   ```
3. Install CocoaPods, which is not installed yet: `brew install cocoapods`, then `pod --version`.
4. In Xcode › Settings › Accounts, sign in with the Apple Developer account and note the **Team ID**. Sign in with Apple (card M1b) needs a paid developer team; a free personal team cannot use it.
5. On the iPhone, turn on Settings › Privacy & Security › Developer Mode. Connect it with a cable and tap Trust.
6. After M1a is merged, run this smoke test:
   ```sh
   npm install
   cd apps/mobile
   npx expo prebuild --platform ios --clean   # writes apps/mobile/ios (git-ignored)
   npx expo run:ios                           # builds and opens the simulator
   npx expo run:ios --device                  # builds for the connected iPhone
   ```
7. `npm run test:swift -w @waypoint/mobile` (from card M5 on). It already works without Xcode; see "Tests".

Things that work only on a real iPhone, not the simulator: the document camera (M7), SpeechTranscriber (M6), and background recording with the screen locked (M5). The on-device model (M8) works in the simulator only when the Mac itself has Apple Intelligence turned on.

---

## 1. Setup

### Versions

Each version below was published at least 14 days before 2026-11-19 and is the version Expo SDK 58 (`expo@58.0.23`, from its `bundledNativeModules.json`) expects. Pin them exactly, with no `^` or `~`.

| Package | Version | Published | Used for |
|---|---|---|---|
| `expo` | 58.0.23 | 2026-11-03 | SDK 58 |
| `react-native` | 0.88.1 | 2026-10-27 | New Architecture, Hermes |
| `react` | 19.3.0 | 2026-09-09 | also pinned in the root `overrides` (see below) |
| `react-dom` | 19.3.0 | 2026-09-09 | root `overrides` only (a peer of expo-router) |
| `@types/react` | 19.3.0 | 2026-09-09 | dev |
| `expo-router` | 58.0.30 | 2026-11-03 | navigation |
| `react-native-screens` | 4.30.1 | 2026-10-28 | expo-router peer |
| `react-native-safe-area-context` | 5.11.1 | 2026-11-03 | expo-router peer |
| `expo-constants` | 58.0.15 | 2026-11-03 | expo-router peer, app version |
| `expo-linking` | 58.0.16 | 2026-11-03 | expo-router peer, open Settings |
| `expo-status-bar` | 58.0.4 | 2026-10-21 | |
| `expo-build-properties` | 58.0.12 | 2026-10-31 | iOS deployment target |
| `expo-dev-client` | 58.0.18 | 2026-10-31 | development builds |
| `@clerk/expo` | 4.15.1 | 2026-11-05 | sign-in (peer `expo >=54 <59`) |
| `expo-secure-store` | 58.0.2 | 2026-10-01 | Clerk token cache |
| `expo-apple-authentication` | 58.0.2 | 2026-09-29 | native Sign in with Apple |
| `expo-crypto` | 58.0.7 | 2026-10-16 | Clerk Apple flow, `randomUUID()` |
| `expo-sqlite` | 58.0.15 | 2026-10-31 | device database, FTS5 |
| `expo-file-system` | 58.0.13 | 2026-10-28 | file sizes, paths |
| `expo-image-picker` | 58.0.10 | 2026-10-01 | "From Photos" (system picker, multi-select) |
| `ts-fsrs` | 5.4.2 | 2026-09-01 | flashcard scheduling (no dependencies) |
| `zod` | 4.6.7 | (repo) | checking what native modules return |
| `@types/node` | 24.19.2 | (repo) | dev, test typecheck only |
| `typescript`, `vitest` | 7.0.2, 5.1.1 | (root) | already in the root `package.json` |

Not used, on purpose:

- `@clerk/clerk-expo` is deprecated; use `@clerk/expo`.
- `jest-expo`: stage 1 has no component tests (see "Tests").
- `expo-updates`: over-the-air updates go through Zephyr (M2), never EAS Update.
- sqlite-vec: the `expo-sqlite` 58 package does not ship the iOS `vec.xcframework`, so turning on `withSQLiteVecExtension` fails at runtime on iOS (expo/expo#43455, still open). Search vectors are stored as BLOBs and compared in TypeScript instead (M9a).
- `expo-audio` and `expo-camera`: recording and page capture are our own Swift modules.
- `@module-federation/metro` 2.9.3 declares Metro `^0.82.1`, but SDK 58 ships Metro 0.87. That is for M2 to resolve.

`npm install` resolves transitive dependencies (for example `@clerk/shared`) to their newest matching versions, and `package-lock.json` pins them.

### Minimum iOS: 26.0

Set through `expo-build-properties` (`ios.deploymentTarget: "26.0"`). The reasons:

- **Speech to text** uses `SpeechAnalyzer` with `SpeechTranscriber`, or `DictationTranscriber` on phones where `SpeechTranscriber.isAvailable` is false. Both are iOS 26 APIs. They run offline, with no one-minute limit, and the speech model is managed by the system (`AssetInventory`). Supporting iOS 18 would mean a second, older path on `SFSpeechRecognizer`.
- **Flashcards, quiz and help** use Apple's Foundation Models framework, which is iOS 26 only. It also needs an Apple Intelligence iPhone: iPhone 15 Pro or 15 Pro Max, any iPhone 16 or later, iPhone Air, or iPhone Duo, with Apple Intelligence turned on and a supported language. On every other phone those three features show why they are unavailable (M8, M11). Recording, the transcript, pages and search still work.
- **Page reading** uses Vision's `RecognizeTextRequest` (iOS 18) and VisionKit's document camera (iOS 13). **Search vectors** use `NLEmbedding.sentenceEmbedding` (iOS 14).
- The Kokoro voices (stage 3) need iOS 18, which 26 already covers.

iOS 26 runs on iPhone 11 and later. Developers report, without Apple confirming it, that `SpeechTranscriber` needs an iPhone 12 or later; older phones get `DictationTranscriber` through the same code.

### How `apps/mobile` sits in the npm-workspaces monorepo

These steps were tried here: a scratch copy of the app was made in this worktree, then deleted.

- `apps/mobile` is a workspace because the root already has `apps/*`. Its name is `@waypoint/mobile`, and `"main": "expo-router/entry"` (an app, not a package, so not `src/index.ts`).
- **Root `package.json` needs `overrides`.** Without them, npm hoists `react@19.3.1`, pulled in through `react: "*"` peers, to the root, and nests the app's `react@19.3.0` under `apps/mobile/node_modules`. Two Reacts crash at runtime. With `"overrides": { "react": "19.3.0", "react-dom": "19.3.0" }`, `npm ls react` shows a single 19.3.0. Card M1a adds this; it is the only root change on this track. Add the overrides in the same change that adds the app. If a lockfile already resolved `react@19.3.1`, adding the overrides afterwards is not enough: restore `package-lock.json` from `main`, delete `node_modules`, then run `npm install`.
- **No `metro.config.js` and no `babel.config.js`.** SDK 58's `expo/metro-config` detects the monorepo by itself. `npx expo export --platform ios` bundled the app with an import of `@waypoint/contracts` (TypeScript source, `.ts` import extensions, zod) and produced Hermes bytecode with no extra config. Do not add `watchFolders`, `nodeModulesPaths` or `extraNodeModules`.
- **Autolinking** finds local native modules in `apps/mobile/modules/*`, the default `nativeModulesDir`. `npx expo-modules-autolinking resolve --platform apple` listed a test module there.
- **TypeScript:** `apps/mobile/tsconfig.json` extends the root `tsconfig.base.json`, so strict mode, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` and `.ts` import extensions all apply. It adds `jsx`, the `dom` lib and the `react-native` export condition. Test files get a second tsconfig with Node types. TypeScript 7 sets `types` to `[]` by default, so Node's types stay out of the app code. Root `npm run typecheck` and `npm test` passed with the app present. TypeScript 7.0.2 checks the React Native and expo-router types without errors, and a bad JSX prop is reported.
- **Native folders are generated** (Continuous Native Generation). `npx expo prebuild --platform ios` writes `apps/mobile/ios` from `app.json` and the config plugins. It ran here without Xcode, using `--no-install`. `ios/` is git-ignored and never edited by hand; every Info.plist key, entitlement and background mode goes into `app.json`.
- npm 12 prints `install-scripts ... blocked` warnings, for `esbuild`, `core-js` and similar packages. They are harmless here; do not approve scripts as part of a card.

### Tests

- **TypeScript logic:** Vitest 5.1.1, run in Node from `apps/mobile/test/`. Only code in `src/core/` is tested this way. That folder may not import React Native, Expo, Clerk or native modules, and a test checks this (M1a). Database code is tested against `node:sqlite`, Node's built-in SQLite 3.53 with FTS5, through the same small `SqlDb` type the phone uses (M4). This is how the API tests already work.
- **No component tests in stage 1.** `jest-expo` 58 would add Jest 30, Babel and the React Native preset for little gain while screens stay thin. Screens are checked by hand on the device; each card lists a "Device check".
- **Swift logic:** pure Swift goes in `modules/<name>/ios/Core/`, which imports only Foundation. Its tests use **Swift Testing** (`import Testing`) in `modules/<name>/ios/Tests/`, run by one SwiftPM package at `apps/mobile/modules/Package.swift` with `swift test`.
  - This already runs on this Mac with the Command Line Tools (Swift 6.1.2), with no Xcode. XCTest is not in the Command Line Tools; Swift Testing is.
  - The pods compile the same `Core` files and exclude `Tests`.
  - Code that needs iOS frameworks (AVAudioSession, Speech, VisionKit, FoundationModels) stays thin and is checked on the device.
- **Bundle check:** `npm run export:ios -w @waypoint/mobile` runs Metro and the Hermes compiler with no Xcode. It catches resolution and import errors that `tsc` misses.

### Commands

| Check | Command (from the repo root unless noted) | Needs Xcode |
|---|---|---|
| Types | `npm run typecheck` | no |
| TypeScript tests | `npm test` | no |
| JS bundle for iOS | `npm run export:ios -w @waypoint/mobile` | no |
| Generate `ios/` | `npm run prebuild -w @waypoint/mobile` | no |
| Swift logic tests | `npm run test:swift -w @waypoint/mobile` (from M5 on) | no |
| Build and run in the simulator | `cd apps/mobile && npx expo run:ios` | yes |
| Build and run on the iPhone | `cd apps/mobile && npx expo run:ios --device` | yes, plus signing |
| Command-line build only | `cd apps/mobile/ios && xcodebuild -workspace Waypoint.xcworkspace -scheme Waypoint -configuration Debug -destination 'generic/platform=iOS Simulator' build` | yes |
| Start the dev server for a dev build | `cd apps/mobile && npx expo start --dev-client` | no |

The Clerk publishable key goes in `apps/mobile/.env.local` as `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...`. That file is git-ignored; Expo inlines `EXPO_PUBLIC_*` values at bundle time.

### Rules for every mobile card

On top of `AGENTS.md`:

1. Files only under `apps/mobile/`, plus `package-lock.json`, unless the card names another path.
2. Folders:
   - `src/app/`: Expo Router routes. Each route file only re-exports a screen and sets options.
   - `src/features/<capture|study|search|settings>/`: screens and their hooks. A feature never imports another feature; navigate by route path instead. Each feature folder is meant to become one Zephyr remote in M2.
   - `src/core/`: plain TypeScript, tested in Node. It imports only `src/core`, `@waypoint/contracts`, `zod` and `ts-fsrs`.
   - `src/platform/`: the only code that opens the database, talks to Clerk, or reads files.
   - `src/ui/`: theme and shared components.
   - `modules/<name>/`: native modules.
3. Core functions that need a clock or new ids take `now: () => number` and `newId: () => string` parameters. On the phone these are `Date.now` and `randomUUID` from `expo-crypto`.
4. Timestamps are Unix milliseconds. Times inside a session (`t`, `t_start`, `t_end`, `startMs`) are milliseconds since the session started.
5. Stage 1 sends nothing over the network except Clerk sign-in. No note text, transcript, page text or file goes anywhere.
6. Use the screen copy the card gives. Never label anything "AI-generated". The word for a person's folder is "space".
7. `apps/mobile/ios/` is never committed. Info.plist keys, entitlements and background modes go in `app.json`.
8. Swift: testable logic goes in `ios/Core/`, Foundation only, with tests in `ios/Tests/`; the module file stays thin. Until Xcode is installed, Swift outside `Core/` cannot be compiled. Say so under "How it was checked".
9. Before opening the pull request, run `npm install`, `npm run typecheck`, `npm test` and `npm run export:ios -w @waypoint/mobile`, plus `npm run test:swift -w @waypoint/mobile` when the card has Swift. Paste the last lines of each.
10. Add a **"Device check"** section to the pull request description. Copy the card's device steps and mark each one passed, failed, or "not run: no Xcode yet".

---

## 2. Stage 1 cards

| Card | Title | After | Sittings |
|---|---|---|---|
| M1a | App shell: Expo app, routes, tabs, theme | — | 1 |
| M1b | Sign-in with Clerk | M1a | 1 |
| M4 | Device SQLite: schema, migrations, spaces, settings | M1a | 1 |
| M5 | Native: audio capture and background recording | M4 | 1 |
| M6 | Native: on-device speech to text | M5 | 1 |
| M7 | Native: page camera and page reading | M4 | 1 |
| M8 | Native: on-device model for flashcards, quiz and help | M4 | 1 |
| M9a | Native and core: search index | M4 | 1 |
| M9b | Search screen | M9a | 1 |
| M10a | Capture: Home, spaces, the "Saving to" pill | M1b, M4 | 1 |
| M10b | Capture: live recording screen | M6, M10a | 1 |
| M10c | Capture: snap pages, From Photos, Your pages, the session screen | M7, M10a | 1 |
| M11a | Study: flashcards and Review | M8, M10c | 1 |
| M11b | Study: quiz and help with a problem | M11a | 1 |
| M12 | Settings | M10b, M11a, M9a | 1 |

Cards with no arrow between them touch different folders and can run in parallel. M5 to M9a each add one entry to `app.json` and one or two dependencies to `apps/mobile/package.json`. Add only your own lines; conflicts are sorted out when merging.

### M1a · `apps/mobile`: Expo app, routes, tabs, theme

Branch `pr/m1a-app-shell`. Files: root `package.json` (the `overrides` block only), and under `apps/mobile/`: `package.json`, `app.json`, `tsconfig.json`, `.gitignore`, `src/app/_layout.tsx`, `src/app/(tabs)/_layout.tsx`, `src/app/(tabs)/index.tsx`, `src/app/(tabs)/spaces.tsx`, `src/app/(tabs)/record.tsx`, `src/app/(tabs)/review.tsx`, `src/app/(tabs)/search.tsx`, `src/app/record.tsx`, `src/app/settings.tsx`, `src/ui/theme.ts`, `src/ui/Placeholder.tsx`, `src/core/format.ts`, `test/tsconfig.json`, `test/format.test.ts`, `test/boundaries.test.ts`. Plus `package-lock.json`. No other files.

Why it looks like this: the host shell is a plain Expo Router app. Feature screens come later, one folder per feature, so M2 can turn each folder into an over-the-air remote. The tab bar follows B1/T1: Home, Spaces, a centre Record button, Review, Search. Settings opens from the avatar on Home (M10a); in this card it is reachable only by URL.

Root `package.json`: add this block after `devDependencies` and change nothing else:

```json
"overrides": {
  "react": "19.3.0",
  "react-dom": "19.3.0"
}
```

`apps/mobile/package.json`, exactly:

```json
{
  "name": "@waypoint/mobile",
  "version": "0.0.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start --dev-client",
    "ios": "expo run:ios",
    "prebuild": "expo prebuild --platform ios --clean",
    "export:ios": "expo export --platform ios --output-dir dist",
    "test": "vitest run --dir test",
    "typecheck": "tsc -p tsconfig.json && tsc -p test/tsconfig.json"
  },
  "dependencies": {
    "@waypoint/contracts": "0.0.0",
    "expo": "58.0.23",
    "expo-build-properties": "58.0.12",
    "expo-constants": "58.0.15",
    "expo-dev-client": "58.0.18",
    "expo-linking": "58.0.16",
    "expo-router": "58.0.30",
    "expo-status-bar": "58.0.4",
    "expo-symbols": "58.0.4",
    "react": "19.3.0",
    "react-native": "0.88.1",
    "react-native-safe-area-context": "5.11.1",
    "react-native-screens": "4.30.1"
  },
  "devDependencies": {
    "@types/node": "24.19.2",
    "@types/react": "19.3.0"
  }
}
```

`expo-symbols` 58.0.4 (published 2026-10-03) draws SF Symbols for the tab icons. `@waypoint/contracts` is not imported yet; it is listed now so the workspace link is in the lockfile from the start. If the reviewer objects, remove it here and add it in M3.

`apps/mobile/app.json`, exactly. The bundle id is a placeholder until the owner picks one (see Open questions):

```json
{
  "expo": {
    "name": "Waypoint",
    "slug": "waypoint",
    "scheme": "waypoint",
    "version": "0.1.0",
    "orientation": "portrait",
    "userInterfaceStyle": "automatic",
    "platforms": ["ios"],
    "ios": {
      "bundleIdentifier": "app.waypoint.ios",
      "buildNumber": "1",
      "supportsTablet": false,
      "infoPlist": {}
    },
    "plugins": [
      "expo-router",
      ["expo-build-properties", { "ios": { "deploymentTarget": "26.0" } }]
    ]
  }
}
```

`apps/mobile/tsconfig.json`, exactly:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["es2022", "dom"],
    "customConditions": ["react-native"]
  },
  "include": ["src", "modules/*/index.ts", "modules/*/src"]
}
```

`apps/mobile/test/tsconfig.json`, exactly:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": [".", "../src/core"]
}
```

`apps/mobile/.gitignore`, exactly:

```
.expo/
dist/
expo-env.d.ts
ios/
android/
modules/.build/
.env*.local
*.tsbuildinfo
```

`src/ui/theme.ts`, exactly (the tokens from "01 · Foundations · Color"; `onRec` is the token added in the journey pass):

```ts
import { useColorScheme } from "react-native";

// Colour tokens from the design file (01 · Foundations · Color). Names match the tokens there.
export const light = {
  bg: "#F7F3EB", surface: "#FFFFFF", surface2: "#F0EBE0", surface3: "#E6E0D2",
  line: "#E5DFD1", lineStrong: "#CEC6B4",
  ink: "#1B1915", ink2: "#4D4940", ink3: "#6F6A5C", ink4: "#A59F8F",
  accent: "#3B34D6", accentStrong: "#2C26B8", accentSoft: "#E8E6FC", onAccent: "#FFFFFF",
  rec: "#EE4B3C", recSoft: "#FDE6E2", onRec: "#FFFFFF",
  flag: "#F4A800", flagSoft: "#FFF0C7", flagInk: "#7A5200",
  local: "#2B8A57", localSoft: "#DDF2E5", localInk: "#1B6B40",
  cloud: "#1C84D4", cloudSoft: "#DDEEFB", cloudInk: "#0F5C9A",
  danger: "#C6362B", dangerSoft: "#FBE3E0",
} as const;

export type Colors = { readonly [K in keyof typeof light]: string };

export const dark: Colors = {
  bg: "#11100E", surface: "#1A1917", surface2: "#232220", surface3: "#2D2B28",
  line: "#34322D", lineStrong: "#4B4841",
  ink: "#F6F2EA", ink2: "#CBC5B7", ink3: "#9F9889", ink4: "#6B665A",
  accent: "#9993FF", accentStrong: "#B3AEFF", accentSoft: "#2A2766", onAccent: "#12104A",
  rec: "#FF6A5B", recSoft: "#3B1D19", onRec: "#11100E",
  flag: "#FFC53D", flagSoft: "#3A2D0B", flagInk: "#FFD982",
  local: "#5BCB8A", localSoft: "#15301F", localInk: "#93E3B3",
  cloud: "#5EB5F6", cloudSoft: "#122A3F", cloudInk: "#A1D4FA",
  danger: "#FF7C6C", dangerSoft: "#3A1C18",
};

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}
```

`src/ui/Placeholder.tsx`: `export function Placeholder({ title }: { title: string })` renders a full-screen `View` (`flex: 1`, centred, `backgroundColor: colors.bg`) with the title in a `Text` (`colors.ink`, size 28, weight "600").

`src/app/_layout.tsx`, exactly:

```tsx
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColors } from "../ui/theme.ts";

export default function RootLayout() {
  const colors = useColors();
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="record" options={{ presentation: "fullScreenModal", gestureEnabled: false }} />
        <Stack.Screen name="settings" />
      </Stack>
    </>
  );
}
```

`src/app/(tabs)/_layout.tsx`, exactly. The Record tab never shows its own screen; pressing it opens the full-screen recording route:

```tsx
import type { ColorValue } from "react-native";
import { Tabs, router } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useColors } from "../../ui/theme.ts";

function icon(name: SFSymbol) {
  return ({ color }: { color: ColorValue }) => <SymbolView name={name} tintColor={color} size={24} />;
}

export default function TabsLayout() {
  const colors = useColors();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.ink3,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: icon("house") }} />
      <Tabs.Screen name="spaces" options={{ title: "Spaces", tabBarIcon: icon("folder") }} />
      <Tabs.Screen
        name="record"
        options={{ title: "Record", tabBarIcon: icon("mic.circle.fill") }}
        listeners={{
          tabPress: (event) => {
            event.preventDefault();
            router.push("/record");
          },
        }}
      />
      <Tabs.Screen name="review" options={{ title: "Review", tabBarIcon: icon("rectangle.stack") }} />
      <Tabs.Screen name="search" options={{ title: "Search", tabBarIcon: icon("magnifyingglass") }} />
    </Tabs>
  );
}
```

The route files `(tabs)/index.tsx`, `(tabs)/spaces.tsx`, `(tabs)/record.tsx`, `(tabs)/review.tsx`, `(tabs)/search.tsx`, `record.tsx` and `settings.tsx` each have a default export that renders `<Placeholder title="..." />` with the screen's name: Home, Spaces, Record, Review, Search, Recording, Settings.

`src/core/format.ts`:

```ts
// "00:42:17" for 2,537,000 ms. Negative values count as 0; hours are not capped.
export function formatClock(ms: number): string
// "42:17" under an hour, "1:02:05" from an hour on. Used for transcript times.
export function formatOffset(ms: number): string
```

`test/format.test.ts`:
- `formatClock`: 0 → `"00:00:00"`, 2_537_000 → `"00:42:17"`, -5 → `"00:00:00"`, 999 → `"00:00:00"`, 360_000_000 → `"100:00:00"`.
- `formatOffset`: 0 → `"0:00"`, 2_537_000 → `"42:17"`, 3_725_000 → `"1:02:05"`.

`test/boundaries.test.ts`, exactly. It enforces the folder rules in this file:

```ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");
const CORE = join(SRC, "core");
const FEATURES = join(SRC, "features");
const CORE_PACKAGES = ["@waypoint/contracts", "zod", "ts-fsrs"];

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1] ?? "");
}

describe("folder rules", () => {
  it("src/core imports only src/core and plain packages", () => {
    for (const file of sourceFiles(CORE)) {
      for (const spec of importsOf(file)) {
        const where = `${relative(SRC, file)} imports ${spec}`;
        if (spec.startsWith(".")) expect(join(dirname(file), spec).startsWith(CORE + "/"), where).toBe(true);
        else expect(CORE_PACKAGES.includes(spec), where).toBe(true);
      }
    }
  });

  it("a feature never imports another feature", () => {
    for (const feature of existsSync(FEATURES) ? readdirSync(FEATURES) : []) {
      for (const file of sourceFiles(join(FEATURES, feature))) {
        for (const spec of importsOf(file).filter((s) => s.startsWith("."))) {
          const target = join(dirname(file), spec);
          if (target.startsWith(FEATURES + "/")) {
            expect(target.startsWith(join(FEATURES, feature) + "/"), `${relative(SRC, file)} imports ${spec}`).toBe(true);
          }
        }
      }
    }
  });
});
```

Checks without Xcode, all of which must pass:
- `npm ls react` shows only `react@19.3.0`.
- Root `npm run typecheck` and `npm test` pass, including every existing package.
- `npm run export:ios -w @waypoint/mobile` prints `iOS Bundled` and writes a `.hbc` file.
- `npm run prebuild -w @waypoint/mobile` finishes. `apps/mobile/ios/Waypoint.xcodeproj/project.pbxproj` contains `IPHONEOS_DEPLOYMENT_TARGET = 26.0`. `git status` does not list `ios/`.
- To check that the boundary test bites, put `import { Text } from "react-native";` in a scratch file under `src/core/`, confirm the test fails, then delete the file.

Device check (once Xcode is installed): `npx expo run:ios` opens the simulator. The five tabs show with icons. Tapping Record opens the full-screen "Recording" placeholder, which cannot be swiped away. Dark mode (Settings › Developer › Dark Appearance in the simulator) switches the background to `#11100E`.

Not in this PR: sign-in (M1b), the database (M4), any real screen, app icon and splash art, `@module-federation/metro` and Zephyr (M2), the iPad layout.

### M1b · Sign-in with Clerk

Branch `pr/m1b-sign-in`. Dependencies: `@clerk/expo` 4.15.1, `expo-secure-store` 58.0.2, `expo-apple-authentication` 58.0.2, `expo-crypto` 58.0.7. Files: `apps/mobile/package.json` (the four dependencies), `app.json` (see below), `src/platform/auth.tsx`, `src/core/auth/gate.ts`, `src/core/auth/email.ts`, `src/shell/SignInScreen.tsx`, `src/shell/CheckEmailScreen.tsx`, `src/app/_layout.tsx`, `src/app/sign-in.tsx`, `src/app/check-email.tsx`, `test/gate.test.ts`, `test/email.test.ts`. Plus `package-lock.json`.

`src/shell/` is a new folder for screens that belong to the host shell rather than to a feature bundle: sign-in now, the update loader in M2. It follows the same rules as `src/features/`.

**Is sign-in required for the free features?** The docs say yes, and this card follows them:
- The first screen is A1 Welcome ("Continue with Apple", "Continue with email").
- Its designer note says: "Clerk proves who you are. No key exists yet, so Continue opens setup, never notes."
- Starter credits are granted per account (wave 3, PR 19).

The recommendation to the owner is the opposite: let the on-device features work without an account, and ask for sign-in only when something needs the server (credits, sync, sharing). The reasons:
- Notes never need the server.
- Making accounts for under-13 students brings parental-consent duties.
- It removes a wall before the first recording.

If the owner agrees, set the `REQUIRE_SIGN_IN` constant to `false` in `gate.ts` and add a "Sign in" row in Settings. See Open questions.

**Offline start.** The app must open with no network once someone has signed in on this phone.
- Clerk's `__experimental_resourceCache` caches the client and environment in SecureStore, so Clerk loads offline.
- Because that option is experimental, the gate has a second line of defence. If Clerk has not loaded within 3 seconds and this phone has signed in before, the app opens anyway.
- Signing in never unlocks notes; it only proves who someone is. The notes stay on the phone either way.

`app.json`: add `"usesAppleSignIn": true` under `ios`, and append `"expo-apple-authentication"` and `"@clerk/expo"` to `plugins`. Do **not** add the `expo-secure-store` plugin; it only adds a Face ID prompt string that the app does not need. After `npm run prebuild -w @waypoint/mobile`, `ios/Waypoint/Waypoint.entitlements` contains `com.apple.developer.applesignin`, and `Info.plist` has no `NSFaceIDUsageDescription`. Both were checked here.

`src/core/auth/gate.ts`:

```ts
export const REQUIRE_SIGN_IN = true;
export const OFFLINE_GRACE_MS = 3000;
export type GateInput = { requireSignIn: boolean; clerkLoaded: boolean; clerkSignedIn: boolean; signedInBefore: boolean; waitedMs: number };
export type Gate = "wait" | "app" | "sign_in";
export function decideGate(input: GateInput): Gate
```

The rules, checked in this order:
1. `requireSignIn` is false → `"app"` (the app passes `REQUIRE_SIGN_IN`).
2. `clerkLoaded` and `clerkSignedIn` → `"app"`.
3. `clerkLoaded` and not signed in → `"sign_in"`.
4. Not loaded, `signedInBefore`, and `waitedMs >= OFFLINE_GRACE_MS` → `"app"`.
5. Not loaded and not `signedInBefore`, with `waitedMs >= 15000` → `"sign_in"`. The sign-in screen then shows the offline message when a request fails.
6. Otherwise `"wait"`.

`src/core/auth/email.ts`: `export function normalizeEmail(input: string): string | null`. It trims and lower-cases the input, then returns it if it matches `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` and is at most 254 characters; otherwise it returns `null`.

`src/platform/auth.tsx`. This code was checked here: it typechecks and bundles with `@clerk/expo` 4.15.1. Keep the Clerk calls exactly as shown:

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { ClerkProvider, useAuth, useSignIn, useSignUp, useUser, type TokenCache } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { resourceCache } from "@clerk/expo/resource-cache";
import { useSignInWithApple } from "@clerk/expo/apple";
import * as SecureStore from "expo-secure-store";
import { REQUIRE_SIGN_IN, decideGate, type Gate } from "../core/auth/gate.ts";

const publishableKey: string = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
const SIGNED_IN_BEFORE = "waypoint.signed_in_before";

function secureTokenCache(): TokenCache {
  if (!tokenCache) throw new Error("secure token cache unavailable");
  return tokenCache;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={secureTokenCache()} __experimental_resourceCache={resourceCache}>
      {children}
    </ClerkProvider>
  );
}

export type SendResult = "sign_in" | "sign_up" | "error";
export type VerifyResult = "ok" | "wrong_code" | "error";

// Email code for both new and returning people: try sign-in; an unknown email becomes a sign-up.
export function useEmailCode() {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  return {
    async send(emailAddress: string): Promise<SendResult> {
      try {
        const r = await signIn.emailCode.sendCode({ emailAddress });
        if (!r.error) return "sign_in";
        if (r.error.code !== "form_identifier_not_found") return "error";
        const created = await signUp.create({ emailAddress });
        if (created.error) return "error";
        const sent = await signUp.verifications.sendEmailCode();
        return sent.error ? "error" : "sign_up";
      } catch {
        return "error";
      }
    },
    async verify(mode: "sign_in" | "sign_up", code: string): Promise<VerifyResult> {
      try {
        const r = mode === "sign_in" ? await signIn.emailCode.verifyCode({ code }) : await signUp.verifications.verifyEmailCode({ code });
        if (r.error) return r.error.code === "form_code_incorrect" ? "wrong_code" : "error";
        const done = mode === "sign_in" ? signIn.status === "complete" : signUp.status === "complete";
        if (!done) return "error";
        const finished = mode === "sign_in" ? await signIn.finalize() : await signUp.finalize();
        return finished.error ? "error" : "ok";
      } catch {
        return "error";
      }
    },
  };
}

// Native Sign in with Apple. Returns false when the person cancels or Clerk refuses.
export function useAppleSignIn(): () => Promise<boolean> {
  const { startAppleAuthenticationFlow } = useSignInWithApple();
  return async () => {
    try {
      const { createdSessionId, setActive } = await startAppleAuthenticationFlow();
      if (!createdSessionId || !setActive) return false;
      await setActive({ session: createdSessionId });
      return true;
    } catch {
      return false;
    }
  };
}

export function useGate(): Gate {
  const { isLoaded, isSignedIn } = useAuth();
  const [signedInBefore, setSignedInBefore] = useState(false);
  const [waitedMs, setWaitedMs] = useState(0);
  useEffect(() => {
    SecureStore.getItemAsync(SIGNED_IN_BEFORE).then((v) => setSignedInBefore(v === "1"), () => setSignedInBefore(false));
    const started = Date.now();
    const timer = setInterval(() => setWaitedMs(Date.now() - started), 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (isLoaded && isSignedIn === true) SecureStore.setItemAsync(SIGNED_IN_BEFORE, "1").catch(() => undefined);
  }, [isLoaded, isSignedIn]);
  return decideGate({ requireSignIn: REQUIRE_SIGN_IN, clerkLoaded: isLoaded, clerkSignedIn: isSignedIn === true, signedInBefore, waitedMs });
}

export type Profile = { firstName: string; email: string; initial: string; viaApple: boolean };

export function useProfile(): Profile | null {
  const { user } = useUser();
  if (!user) return null;
  const email = user.primaryEmailAddress?.emailAddress ?? "";
  const firstName = user.firstName ?? email.split("@")[0] ?? "";
  return { firstName, email, initial: (firstName[0] ?? "?").toUpperCase(), viaApple: user.externalAccounts.some((a) => a.provider === "apple") };
}

// Signing out never deletes notes (K1: "Signing out doesn't delete your notes.").
export function useSignOut(): () => Promise<void> {
  const { signOut } = useAuth();
  return async () => {
    await SecureStore.deleteItemAsync(SIGNED_IN_BEFORE);
    await signOut();
  };
}
```

If `user.externalAccounts[].provider` is typed differently in 4.15.1, compare against the value its type allows, and say so in the pull request. Stop the interval once the gate is no longer `"wait"`; how you do that is up to you.

`src/app/_layout.tsx` becomes the following. It was checked here with `Stack.Protected` from expo-router 58:

```tsx
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useGate } from "../platform/auth.tsx";
import { useColors } from "../ui/theme.ts";

function RootStack() {
  const colors = useColors();
  const gate = useGate();
  if (gate === "wait") return null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={gate === "app"}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="record" options={{ presentation: "fullScreenModal", gestureEnabled: false }} />
        <Stack.Screen name="settings" />
      </Stack.Protected>
      <Stack.Protected guard={gate === "sign_in"}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="check-email" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <RootStack />
    </AuthProvider>
  );
}
```

`src/shell/SignInScreen.tsx` (A1, without the passkey link and without the illustration):
- The "Waypoint" wordmark.
- Headline "Record the lecture. Ask about anything. Remember it."; the word "Remember" is in `accent`.
- Body: "Capture a lecture, follow every tangent, and remember it — on your phone, privately."
- `AppleAuthentication.AppleAuthenticationButton` with type `CONTINUE`, style `BLACK` (`WHITE` in dark mode), and corner radius 14. Pressing it calls `useAppleSignIn()`.
- A secondary button "Continue with email". It shows an email field (`keyboardType="email-address"`, `autoComplete="email"`, `autoCapitalize="none"`) and a "Send code" button:
  - `normalizeEmail` returns null → "Enter an email address like name@example.com".
  - `send` returns `"error"` → "Couldn't send the code. Check your connection and try again."
  - On success → `router.push({ pathname: "/check-email", params: { email, mode } })`.
- Footer: "By continuing you agree to the Terms and Privacy Policy." Plain text until the owner gives the URLs.

`src/shell/CheckEmailScreen.tsx` (A2):
- Title "Check your email", then "We sent a 6-digit code to {email}."
- One `TextInput` with `keyboardType="number-pad"`, `textContentType="oneTimeCode"`, `autoComplete="one-time-code"` and `maxLength` 6. Six digits submit by themselves.
- `"wrong_code"` → "That code didn't work. Check it and try again."
- `"error"` → "Something went wrong. Check your connection and try again."
- "Send a new code" calls `send` again. "Use a different email" goes back.
- On `"ok"` there is nothing to do: the gate flips and Expo Router moves to `(tabs)`.

`src/app/sign-in.tsx` and `src/app/check-email.tsx` only re-export the screens.

Tests:
- `test/gate.test.ts`: every rule above with its boundary values (`waitedMs` 2999 and 3000; 14999 and 15000), and that a signed-in result wins over `waitedMs`.
- `test/email.test.ts`: `" Zack@Example.COM "` → `"zack@example.com"`; `"zack@"`, `"@x.io"`, `"a b@c.io"` and `""` → null; a 255-character address → null.

Owner setup in the Clerk dashboard. The pull request lists these steps, and the implementer does not do them:
- Turn on Email with the verification-code strategy.
- Turn on Apple. For native Sign in with Apple, register the iOS app with the Team ID and bundle id, and turn on native applications.
- Put the development instance's publishable key in `apps/mobile/.env.local`.

Device check (needs Xcode, a paid team, and the key in `.env.local`):
1. A fresh install opens on Welcome.
2. Continue with Apple signs in and lands on Home.
3. Kill the app, turn on Airplane Mode, and reopen it. Home opens within about 3 seconds.
4. Sign out from the debugger (`useSignOut`, wired in M12). Email-code sign-in works for a new address and for a returning one.

Not in this PR: passkeys (`@clerk/expo-passkeys`), Google, the Settings sign-out row (M12), sending the Clerk token anywhere (M3), Terms and Privacy links.

### M4 · Device SQLite: schema, migrations, spaces, settings

Branch `pr/m4-device-db`. Dependencies: `expo-sqlite` 58.0.15. Files: `apps/mobile/package.json`, `app.json` (one plugin entry), `src/core/db/sql.ts`, `src/core/db/schema.ts`, `src/core/db/migrate.ts`, `src/core/db/spaces.ts`, `src/core/db/settings.ts`, `src/platform/db.ts`, `test/helpers/db.ts`, `test/migrate.test.ts`, `test/schema.test.ts`, `test/spaces.test.ts`, `test/settings.test.ts`. Plus `package-lock.json`.

Why it looks like this:
- Section 5 "On the device" lists the tables. This card creates every table stage 1 needs, all in migration 1, so later stage-1 cards add no migrations and cannot collide.
- Tables for later stages (`explanations`, `terms`, `overviews`, `outbox`, `sent_log`) come with the stage that uses them, as new migrations.
- The database file stays on the phone. Nothing in it is ever sent anywhere in stage 1.
- Times inside a session are milliseconds since the session started.

Columns beyond section 5, and why:

| Column | Why |
|---|---|
| `spaces.is_default`, `spaces.last_used_at` | "My notes" and the most-recent-first order of T1b |
| `sessions.kind`, `state`, `transcript`, `recorded_ms`, `indexed_at` | Recording or pages; recovery after a crash; whether the transcript is waiting for the speech pack; total recorded time; whether search has indexed the latest content (`NULL` = needs indexing) |
| `captures.position`, `duration_ms`, `found_lines` | Page order (T4 reorder); length of an audio part; text lines with boxes for "tap a problem" (JSON) |
| `cards.capture_id`, `t`, `made_by`, `due_at`, `fsrs` | Which page or moment a card came from; how it was made; scheduling state |
| `chunks` and `chunks_fts` | The text that search indexes; `search_index` holds one vector per chunk |
| `settings` | Small local preferences, for example the last "Saving to" space |

`app.json`: append `["expo-sqlite", { "enableFTS": true }]` to `plugins`. Do not turn on `withSQLiteVecExtension` (see Versions).

`src/core/db/sql.ts`, exactly. `expo-sqlite` on the phone and `node:sqlite` in tests both fit this type:

```ts
// The parts of SQLite the app uses. expo-sqlite (on the phone) and node:sqlite (in tests) both fit it.
export type SqlValue = string | number | null | Uint8Array;

export type RunResult = { changes: number; lastInsertRowId: number };

export type SqlDb = {
  exec(sql: string): void;
  run(sql: string, params?: SqlValue[]): RunResult;
  all<T>(sql: string, params?: SqlValue[]): T[];
  get<T>(sql: string, params?: SqlValue[]): T | null;
  transaction(task: () => void): void;
};
```

`src/core/db/schema.ts`: `export const MIGRATIONS: readonly { version: number; sql: string }[]`. Version 1's `sql` is exactly the following. It was run here on node:sqlite 3.53.4. The cascade from `sessions` to `chunks` also removes the FTS rows, and a second default space is rejected:

```sql
CREATE TABLE spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX spaces_one_default ON spaces (is_default) WHERE is_default = 1;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces (id),
  kind TEXT NOT NULL CHECK (kind IN ('recording', 'pages')),
  title TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('recording', 'paused', 'saved', 'interrupted')),
  transcript TEXT NOT NULL DEFAULT 'none' CHECK (transcript IN ('none', 'live', 'waiting', 'done', 'failed')),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  recorded_ms INTEGER NOT NULL DEFAULT 0 CHECK (recorded_ms >= 0),
  indexed_at INTEGER
);
CREATE INDEX sessions_space ON sessions (space_id, started_at);

CREATE TABLE segments (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  t_start INTEGER NOT NULL CHECK (t_start >= 0),
  t_end INTEGER NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('device', 'cloud')),
  CHECK (t_end >= t_start),
  UNIQUE (session_id, source, t_start)
);

CREATE TABLE captures (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('audio', 'photo', 'page')),
  t INTEGER NOT NULL CHECK (t >= 0),
  position INTEGER NOT NULL DEFAULT 0,
  file TEXT NOT NULL,
  duration_ms INTEGER,
  found_text TEXT,
  found_lines TEXT
);
CREATE INDEX captures_session ON captures (session_id, kind, position);

CREATE TABLE flags (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  t INTEGER NOT NULL CHECK (t >= 0),
  question TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'answered', 'dismissed'))
);

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('term', 'problem', 'question')),
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  capture_id TEXT REFERENCES captures (id) ON DELETE SET NULL,
  t INTEGER,
  made_by TEXT NOT NULL CHECK (made_by IN ('device_model', 'quiz_miss')),
  created_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  fsrs TEXT NOT NULL
);
CREATE INDEX cards_due ON cards (due_at);

CREATE TABLE reviews (
  id INTEGER PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  reviewed_at INTEGER NOT NULL,
  due_before INTEGER NOT NULL,
  due_after INTEGER NOT NULL
);

CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('transcript', 'page', 'photo')),
  capture_id TEXT REFERENCES captures (id) ON DELETE CASCADE,
  t_start INTEGER NOT NULL,
  t_end INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX chunks_session ON chunks (session_id);
CREATE VIRTUAL TABLE chunks_fts USING fts5 (text, content = 'chunks', content_rowid = 'id', tokenize = 'unicode61 remove_diacritics 2');
CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts (rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts (chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;

CREATE TABLE search_index (
  chunk_id INTEGER PRIMARY KEY REFERENCES chunks (id) ON DELETE CASCADE,
  model_version TEXT NOT NULL,
  dim INTEGER NOT NULL CHECK (dim > 0),
  scale REAL NOT NULL,
  vector BLOB NOT NULL
);
CREATE INDEX search_index_model ON search_index (model_version);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

`chunks` rows are only ever inserted and deleted, never updated. That is why there is no update trigger.

`src/core/db/migrate.ts`: `export function migrate(db: SqlDb, migrations = MIGRATIONS): number`.
1. Read `PRAGMA user_version`.
2. If it is above the highest version in `migrations`, throw `new Error("database is newer than this app")`.
3. Apply each migration with a higher version, in order, each inside `db.transaction`: run `exec(sql)`, then `exec("PRAGMA user_version = <version>")`.
4. Return the final version.

A migration that throws leaves the version where it was, and the error is rethrown.

`src/core/db/settings.ts`: `getSetting(db, key): string | null`, `setSetting(db, key, value): void` (an upsert), `deleteSetting(db, key): void`.

`src/core/db/spaces.ts`:

```ts
export type Space = { id: string; name: string; isDefault: boolean; lastUsedAt: number; sessionCount: number };
export const DEFAULT_SPACE_NAME = "My notes";
export class SpaceNameError extends Error {}   // message: "empty" | "too_long" | "taken"
export function ensureDefaultSpace(db: SqlDb, deps: { now: () => number; newId: () => string }): Space
export function listSpaces(db: SqlDb): Space[]            // last_used_at DESC, then name ASC
export function getSpace(db: SqlDb, id: string): Space | null
export function createSpace(db: SqlDb, deps: { now: () => number; newId: () => string }, name: string): Space
export function getSavingTo(db: SqlDb): Space             // setting "saving_to"; falls back to the default space
export function setSavingTo(db: SqlDb, id: string, now: number): void  // also sets last_used_at = now
```

Details:
- `ensureDefaultSpace` creates "My notes" once and returns the existing one after that.
- `createSpace` trims the name. It throws `SpaceNameError("empty")` for an empty name and `("too_long")` for one over 60 characters. A name that already exists, compared case-insensitively, throws `("taken")`.
- `getSavingTo` treats a missing or deleted id as the default.
- `setSavingTo` throws if the space does not exist.

`src/platform/db.ts`:

```ts
import { openDatabaseSync } from "expo-sqlite";
import { useSyncExternalStore } from "react";
import type { SqlDb, SqlValue } from "../core/db/sql.ts";

function openDeviceDb(name: string): SqlDb {
  const db = openDatabaseSync(name);
  db.execSync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  return {
    exec: (sql) => db.execSync(sql),
    run: (sql, params: SqlValue[] = []) => {
      const r = db.runSync(sql, params);
      return { changes: r.changes, lastInsertRowId: r.lastInsertRowId };
    },
    all: <T,>(sql: string, params: SqlValue[] = []) => db.getAllSync<T>(sql, params),
    get: <T,>(sql: string, params: SqlValue[] = []) => db.getFirstSync<T>(sql, params),
    transaction: (task) => db.withTransactionSync(task),
  };
}
```

Add these exports to the same file:
- `getDb(): SqlDb`: opens `waypoint.db` once, runs `migrate`, then `ensureDefaultSpace` with `Date.now` and `randomUUID` from `expo-crypto`. `expo-crypto` is already a dependency from M1b.
- `useQuery<T>(read: (db: SqlDb) => T): T`: re-runs `read` whenever `writeDb` has been called. Build it on `useSyncExternalStore` over a module-level version counter. Cache the result per version: `useSyncExternalStore` must get the same snapshot back until the version changes.
- `writeDb<T>(write: (db: SqlDb) => T): T`: runs `write`, bumps the version, notifies subscribers, and returns the result.

`test/helpers/db.ts`, exactly:

```ts
import { DatabaseSync } from "node:sqlite";
import type { SqlDb, SqlValue } from "../../src/core/db/sql.ts";

export function createMemoryDb(): SqlDb {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, params: SqlValue[] = []) => {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    all: <T,>(sql: string, params: SqlValue[] = []) => db.prepare(sql).all(...params) as T[],
    get: <T,>(sql: string, params: SqlValue[] = []) => (db.prepare(sql).get(...params) ?? null) as T | null,
    transaction: (task) => {
      db.exec("BEGIN");
      try {
        task();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
```

Use `as T[]` here only, in the test helper. `node:sqlite` returns untyped rows. App code uses the generic `all<T>`.

Tests:
- `migrate.test.ts`:
  - A new database ends at version 1, and running `migrate` again changes nothing.
  - `user_version` 99 throws "database is newer than this app".
  - A migrations list whose second entry has bad SQL leaves the version at 1, keeps no tables from the bad entry, and rethrows.
- `schema.test.ts`, with a fresh migrated database:
  - Every table and index above exists (read `sqlite_master`).
  - Each `CHECK` rejects a bad value: `kind` `'video'`, `state` `'other'`, `transcript` `'x'`, `t_end < t_start`, `rating` 0 and 5, a space name of 61 characters.
  - A second default space is rejected.
  - The same `(session_id, source, t_start)` twice is rejected.
  - Deleting a session removes its segments, captures, flags, cards, reviews, chunks, `search_index` rows and FTS matches.
  - Deleting a capture sets `cards.capture_id` to NULL.
  - A `Uint8Array` blob comes back from `search_index` byte for byte.
  - A chunk's text is found by `chunks_fts MATCH`, including a word with a diacritic matched without it ("café" by "cafe").
- `spaces.test.ts`: every rule above, including the order of `listSpaces` and that `sessionCount` counts sessions.
- `settings.test.ts`: get on a missing key, set, overwrite, delete.

Device check: on first launch the app creates `waypoint.db` without an error. There is no visible change until M10a.

Not in this PR: any table not listed above, encryption at rest (decided with `docs/security.md`), repositories for sessions, captures, cards or search (each added by the card that needs it), deleting spaces.

### M5 · Native: audio capture and background recording (`modules/waypoint-audio`)

Branch `pr/m5-audio`. No new npm dependencies. Files, all under `apps/mobile/`:
- `package.json`: the `test:swift` script only.
- `app.json`: the Info.plist keys.
- `modules/Package.swift`.
- `modules/waypoint-audio/expo-module.config.json`, `index.ts`, `src/WaypointAudio.ts`.
- `modules/waypoint-audio/ios/WaypointAudio.podspec`, `ios/WaypointAudioModule.swift`, `ios/AudioRecorder.swift`.
- `modules/waypoint-audio/ios/Core/RecordingTimeline.swift`, `ios/Core/LevelMeter.swift`, `ios/Tests/RecordingTimelineTests.swift`.
- `src/app/dev/audio.tsx`.

Why it looks like this:
- One `AVAudioEngine` input tap does everything: it writes AAC files, feeds the level meter, and (from M6) hands each buffer to the speech analyzer. One capture path keeps audio and words in sync.
- Audio is written in **parts** of at most 5 minutes. A file still being written when the app is killed cannot be read, so a crash loses at most one part.
- A pause ends a run. Resuming starts a new part at the real time, so the gap shows on the timeline (C8: "Gap · 02:14 not captured").
- Pausing never resumes by itself. After a phone call the person taps "Resume recording" (C8).
- Background recording works through `UIBackgroundModes: audio` plus an active audio session. Apple's DTS confirms this keeps the app alive while the screen is locked.
- Each finished part is reported to JavaScript; it becomes a `captures` row of kind `audio` in M10b.

`package.json` script: `"test:swift": "cd modules && swift test"`.

`app.json`: under `ios.infoPlist` add:

```json
"NSMicrophoneUsageDescription": "Waypoint records a class or a talk so it can write down what is said, on this iPhone.",
"UIBackgroundModes": ["audio"]
```

`modules/Package.swift`, exactly. Later cards add their own target pairs:

```swift
// swift-tools-version:6.0
// Plain-Swift logic of the native modules, tested on the Mac with `swift test` (no simulator needed).
// The pods compile the same Core files; Tests are excluded from the pods.
import PackageDescription

let package = Package(
  name: "WaypointNativeCore",
  platforms: [.macOS(.v15)],
  targets: [
    .target(name: "AudioCore", path: "waypoint-audio/ios/Core"),
    .testTarget(name: "AudioCoreTests", dependencies: ["AudioCore"], path: "waypoint-audio/ios/Tests"),
  ]
)
```

`expo-module.config.json`, exactly: `{ "platforms": ["apple"], "apple": { "modules": ["WaypointAudioModule"] } }`

`ios/WaypointAudio.podspec`, exactly:

```ruby
Pod::Spec.new do |s|
  s.name           = 'WaypointAudio'
  s.version        = '1.0.0'
  s.summary        = 'Waypoint audio capture and on-device speech to text'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '26.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files   = '**/*.swift'
  s.exclude_files  = 'Tests/**/*'
end
```

`ios/Core/RecordingTimeline.swift`, exactly. It was compiled and tested here with `swift test`:

```swift
import Foundation

/// One audio file. Times are milliseconds since the session started (wall clock, so pauses leave gaps).
struct RecordingPart: Equatable {
  let index: Int
  let startMs: Int64
  var durationMs: Int64
}

/// Keeps track of runs (start or resume until pause or stop) and the part files inside them.
/// A run is split into parts of at most `maxPartMs`, so a crash loses at most one part.
/// All `now` values come from one monotonic clock, in milliseconds.
struct RecordingTimeline {
  let sessionStart: Int64
  let maxPartMs: Int64
  private(set) var finishedParts: [RecordingPart] = []
  private(set) var current: RecordingPart?
  private(set) var runStartMs: Int64?
  private var partStartedAt: Int64 = 0

  init(sessionStart: Int64, maxPartMs: Int64 = 300_000) {
    self.sessionStart = sessionStart
    self.maxPartMs = maxPartMs
  }

  var isRunning: Bool { current != nil }

  /// Recorded time so far, without gaps.
  func recordedMs(now: Int64) -> Int64 {
    finishedParts.reduce(0) { $0 + $1.durationMs } + (current == nil ? 0 : max(0, now - partStartedAt))
  }

  /// Starts a run (start or resume). Returns the new part, or nil if a run is already going.
  mutating func startRun(now: Int64) -> RecordingPart? {
    guard current == nil else { return nil }
    runStartMs = max(0, now - sessionStart)
    return openPart(now: now)
  }

  /// Ends the run (pause or stop). Returns the finished part, or nil if nothing was running.
  mutating func endRun(now: Int64) -> RecordingPart? {
    let part = closePart(now: now)
    runStartMs = nil
    return part
  }

  /// Call on every audio buffer. If the current part is full, closes it and opens the next one in the
  /// same run; returns (closed, opened). Otherwise returns nil.
  mutating func rollIfNeeded(now: Int64) -> (closed: RecordingPart, opened: RecordingPart)? {
    guard current != nil, now - partStartedAt >= maxPartMs else { return nil }
    guard let closed = closePart(now: now) else { return nil }
    return (closed, openPart(now: now))
  }

  private mutating func openPart(now: Int64) -> RecordingPart {
    let index = finishedParts.count
    let part = RecordingPart(index: index, startMs: max(0, now - sessionStart), durationMs: 0)
    current = part
    partStartedAt = now
    return part
  }

  private mutating func closePart(now: Int64) -> RecordingPart? {
    guard var part = current else { return nil }
    part.durationMs = max(0, now - partStartedAt)
    finishedParts.append(part)
    current = nil
    return part
  }
}
```

`ios/Core/LevelMeter.swift`, exactly:

```swift
import Foundation

enum LevelMeter {
  /// Root mean square of the samples, 0 for an empty buffer.
  static func rms(_ samples: UnsafeBufferPointer<Float>) -> Float {
    guard !samples.isEmpty else { return 0 }
    var sum: Float = 0
    for s in samples { sum += s * s }
    return (sum / Float(samples.count)).squareRoot()
  }

  /// Maps a level to 0...1 for the waveform: -50 dB or quieter is 0, 0 dB is 1, linear in dB between.
  static func normalized(rms: Float) -> Float {
    guard rms > 0 else { return 0 }
    let db = 20 * log10(rms)
    return min(1, max(0, (db + 50) / 50))
  }
}
```

`ios/Tests/RecordingTimelineTests.swift` uses Swift Testing (`import Testing`, `@testable import AudioCore`). It covers at least these cases, each of which passed here:
- start at 1,000 → part `(0, startMs 0)`. A second `startRun` → nil. `endRun` at 61,000 → `(0, 0, 60,000)`. A second `endRun` → nil. `startRun` at 91,000 → `(1, 90,000)` with `runStartMs` 90,000. `recordedMs(now: 101,000)` = 70,000.
- With `maxPartMs` 300,000: no roll at 299,999. A roll at 300,000 closes `(0, 0, 300,000)` and opens `(1, 300,000)`, and `runStartMs` stays 0.
- `LevelMeter`: rms 0 → 0; 1 → 1; 0.001 → 0; 0.0316227766 → 0.4 (±0.001); `rms([0.5, -0.5, 0.5, -0.5])` = 0.5.

`ios/AudioRecorder.swift`. This needs iOS, so it cannot be compiled before Xcode is installed. Write it as below and fix only compile errors.

```swift
import AVFoundation
import Foundation

/// Gets every recorded buffer. The speech part (M6) implements it. Called on the recorder's io queue.
protocol AudioBufferSink: AnyObject {
  func runStarted(sessionId: String, runStartMs: Int64, format: AVAudioFormat)
  func append(_ buffer: AVAudioPCMBuffer)
  func runEnded()
}

enum RecorderError: Error { case busy, notRecording, notPaused, micDenied }

/// Two serial queues:
/// - `control` runs start, pause, resume and stop.
/// - `io` owns the timeline, the open file and the sink, and the tap runs its work on it.
/// The engine is stopped on `control` and never inside `io.sync`, so stopping cannot deadlock with the tap.
final class AudioRecorder {
  static let maxPartMs: Int64 = 300_000
  var onEvent: ((String, [String: Any]) -> Void)?
  weak var sink: AudioBufferSink?

  private let control = DispatchQueue(label: "waypoint.audio.control")
  private let io = DispatchQueue(label: "waypoint.audio.io")
  private var engine = AVAudioEngine()
  private var sessionId: String?          // control
  private var paused = false              // control
  private var observers: [NSObjectProtocol] = []
  private var ioSessionId: String?        // io
  private var timeline: RecordingTimeline? // io
  private var file: AVAudioFile?          // io
  private var lastLevelAt: Int64 = 0      // io

  static func now() -> Int64 { Int64(clock_gettime_nsec_np(CLOCK_MONOTONIC) / 1_000_000) }

  static var documents: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }

  static func partPath(sessionId: String, index: Int) -> String { "sessions/\(sessionId)/audio-\(index).m4a" }

  static func micPermission() -> String {
    switch AVAudioApplication.shared.recordPermission {
    case .granted: return "granted"
    case .denied: return "denied"
    default: return "undetermined"
    }
  }

  static func requestMicPermission() async -> String {
    _ = await AVAudioApplication.requestRecordPermission()
    return micPermission()
  }

  func start(sessionId: String) throws {
    try control.sync {
      guard self.sessionId == nil else { throw RecorderError.busy }
      guard AVAudioApplication.shared.recordPermission == .granted else { throw RecorderError.micDenied }
      let audio = AVAudioSession.sharedInstance()
      try audio.setCategory(.playAndRecord, mode: .default, options: [.allowBluetoothHFP])
      try audio.setActive(true)
      try FileManager.default.createDirectory(
        at: Self.documents.appendingPathComponent("sessions/\(sessionId)", isDirectory: true),
        withIntermediateDirectories: true)
      self.sessionId = sessionId
      io.sync {
        self.ioSessionId = sessionId
        self.timeline = RecordingTimeline(sessionStart: Self.now(), maxPartMs: Self.maxPartMs)
      }
      addObservers()
      do { try startRun() } catch { finish(); throw error }
    }
  }

  func pause(reason: String) throws {
    try control.sync {
      guard sessionId != nil, !paused else { throw RecorderError.notRecording }
      pauseInControl(reason: reason)
    }
  }

  func resume() throws {
    try control.sync {
      guard sessionId != nil, paused else { throw RecorderError.notPaused }
      try startRun()
    }
  }

  /// Stops and returns the recorded time in ms. Every onPart event is sent before this returns.
  func stop() throws -> Double {
    try control.sync {
      guard sessionId != nil else { throw RecorderError.notRecording }
      if !paused { stopEngine(); endRun() }
      let total = io.sync { Double(timeline?.recordedMs(now: Self.now()) ?? 0) }
      emitState("idle", reason: "none", recordedMs: total)
      finish()
      return total
    }
  }

  func status() -> [String: Any] {
    control.sync {
      let recorded = io.sync { Double(timeline?.recordedMs(now: Self.now()) ?? 0) }
      let state = sessionId == nil ? "idle" : (paused ? "paused" : "recording")
      return ["sessionId": sessionId ?? "", "state": state, "recordedMs": recorded]
    }
  }

  // MARK: control queue only

  private func startRun() throws {
    guard let id = sessionId else { throw RecorderError.notRecording }
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    try io.sync {
      guard var t = timeline, let part = t.startRun(now: Self.now()) else { throw RecorderError.busy }
      timeline = t
      file = try Self.openFile(sessionId: id, index: part.index, format: format)
      sink?.runStarted(sessionId: id, runStartMs: t.runStartMs ?? 0, format: format)
    }
    input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
      self?.handle(buffer)
    }
    engine.prepare()
    do {
      try engine.start()
    } catch {
      input.removeTap(onBus: 0)
      endRun()
      throw error
    }
    paused = false
    emitState("recording", reason: "none", recordedMs: nil)
  }

  private func pauseInControl(reason: String) {
    stopEngine()
    endRun()
    paused = true
    emitState("paused", reason: reason, recordedMs: nil)
  }

  private func stopEngine() {
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
  }

  private func endRun() {
    io.sync {
      guard var t = timeline, let id = ioSessionId else { return }
      let closed = t.endRun(now: Self.now())
      timeline = t
      file = nil   // AVAudioFile finishes and closes the file when it is released
      if let closed { emitPart(closed, sessionId: id) }
      sink?.runEnded()
    }
  }

  private func finish() {
    removeObservers()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    io.sync { timeline = nil; ioSessionId = nil; file = nil }
    sessionId = nil
    paused = false
  }

  // MARK: io queue (called from the tap)

  private func handle(_ buffer: AVAudioPCMBuffer) {
    io.sync {
      guard var t = timeline, let id = ioSessionId else { return }
      let now = Self.now()
      if let rolled = t.rollIfNeeded(now: now) {
        timeline = t
        file = nil
        emitPart(rolled.closed, sessionId: id)
        file = try? Self.openFile(sessionId: id, index: rolled.opened.index, format: buffer.format)
      }
      try? file?.write(from: buffer)
      sink?.append(buffer)
      if now - lastLevelAt >= 100, let channels = buffer.floatChannelData {
        lastLevelAt = now
        let samples = UnsafeBufferPointer(start: channels[0], count: Int(buffer.frameLength))
        onEvent?("onLevel", ["level": Double(LevelMeter.normalized(rms: LevelMeter.rms(samples)))])
      }
    }
  }

  private static func openFile(sessionId: String, index: Int, format: AVAudioFormat) throws -> AVAudioFile {
    let url = documents.appendingPathComponent(partPath(sessionId: sessionId, index: index))
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: format.sampleRate,
      AVNumberOfChannelsKey: format.channelCount,
      AVEncoderBitRateKey: 64_000,
    ]
    return try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
  }

  private func emitPart(_ part: RecordingPart, sessionId: String) {
    onEvent?("onPart", [
      "sessionId": sessionId, "index": part.index, "startMs": Double(part.startMs),
      "durationMs": Double(part.durationMs), "file": Self.partPath(sessionId: sessionId, index: part.index),
    ])
  }

  private func emitState(_ state: String, reason: String, recordedMs: Double?) {
    let recorded = recordedMs ?? io.sync { Double(timeline?.recordedMs(now: Self.now()) ?? 0) }
    onEvent?("onState", ["sessionId": sessionId ?? "", "state": state, "reason": reason, "recordedMs": recorded])
  }

  // MARK: system notices

  private func addObservers() {
    let center = NotificationCenter.default
    observers = [
      center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { [weak self] note in
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
        self?.control.async { if self?.sessionId != nil, self?.paused == false { self?.pauseInControl(reason: "interruption") } }
      },
      center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: nil) { [weak self] note in
        guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
        self?.control.async { if self?.sessionId != nil, self?.paused == false { self?.pauseInControl(reason: "route_change") } }
      },
      center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: nil) { [weak self] _ in
        self?.control.async {
          guard let self else { return }
          if self.sessionId != nil, !self.paused {
            self.endRun()
            self.paused = true
            self.emitState("paused", reason: "media_reset", recordedMs: nil)
          }
          self.engine = AVAudioEngine()
        }
      },
    ]
  }

  private func removeObservers() {
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    observers = []
  }
}
```

The interruption keys are deprecated in the iOS 27 SDK but still work. Leave the warnings alone; the replacement (`didBecomeInactiveNotification`) is iOS 27 only. If `setActive` throws because the app is in the background, the error goes back to JavaScript; the screen only starts a recording from the foreground.

`ios/WaypointAudioModule.swift`:

```swift
import ExpoModulesCore

public class WaypointAudioModule: Module {
  private let recorder = AudioRecorder()

  public func definition() -> ModuleDefinition {
    Name("WaypointAudio")
    Events("onState", "onPart", "onLevel")

    OnCreate {
      self.recorder.onEvent = { [weak self] name, body in self?.sendEvent(name, body) }
    }

    AsyncFunction("getMicPermission") { () -> String in AudioRecorder.micPermission() }
    AsyncFunction("requestMicPermission") { () async -> String in await AudioRecorder.requestMicPermission() }
    AsyncFunction("start") { (sessionId: String) throws in try self.recorder.start(sessionId: sessionId) }
    AsyncFunction("pause") { () throws in try self.recorder.pause(reason: "user") }
    AsyncFunction("resume") { () throws in try self.recorder.resume() }
    AsyncFunction("stop") { () throws -> Double in try self.recorder.stop() }
    Function("getStatus") { () -> [String: Any] in self.recorder.status() }
  }
}
```

`src/WaypointAudio.ts` is the typed TypeScript side. `index.ts` is only `export * from "./src/WaypointAudio.ts";`.

```ts
import { NativeModule, requireNativeModule, type EventSubscription } from "expo";

export type MicPermission = "granted" | "denied" | "undetermined";
export type RecorderState = "idle" | "recording" | "paused";
export type PauseReason = "none" | "user" | "interruption" | "route_change" | "media_reset";
export type StateEvent = { sessionId: string; state: RecorderState; reason: PauseReason; recordedMs: number };
export type PartEvent = { sessionId: string; index: number; startMs: number; durationMs: number; file: string };
export type LevelEvent = { level: number };
export type RecorderStatus = { sessionId: string; state: RecorderState; recordedMs: number };

type Events = {
  onState(event: StateEvent): void;
  onPart(event: PartEvent): void;
  onLevel(event: LevelEvent): void;
};

declare class WaypointAudioNative extends NativeModule<Events> {
  getMicPermission(): Promise<MicPermission>;
  requestMicPermission(): Promise<MicPermission>;
  start(sessionId: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<number>;
  getStatus(): RecorderStatus;
}

const native = requireNativeModule<WaypointAudioNative>("WaypointAudio");

export const getMicPermission = (): Promise<MicPermission> => native.getMicPermission();
export const requestMicPermission = (): Promise<MicPermission> => native.requestMicPermission();
export const startRecording = (sessionId: string): Promise<void> => native.start(sessionId);
export const pauseRecording = (): Promise<void> => native.pause();
export const resumeRecording = (): Promise<void> => native.resume();
export const stopRecording = (): Promise<number> => native.stop();
export const getRecorderStatus = (): RecorderStatus => native.getStatus();
export const onRecorderState = (l: (e: StateEvent) => void): EventSubscription => native.addListener("onState", l);
export const onRecorderPart = (l: (e: PartEvent) => void): EventSubscription => native.addListener("onPart", l);
export const onRecorderLevel = (l: (e: LevelEvent) => void): EventSubscription => native.addListener("onLevel", l);
```

This shape was checked here: a local module with a `declare class ... extends NativeModule<Events>` and `requireNativeModule` from `expo` typechecks, bundles, and is found by autolinking. In the native code, `sessionId` is `""` when idle.

`src/app/dev/audio.tsx`: a bare developer screen, reached only by the URL `waypoint://dev/audio`. Every native card adds one of these for its device check; nothing links to them. It shows:
- buttons Permission, Start, Pause, Resume, Stop;
- the last `onState` event;
- the list of `onPart` events;
- a bar whose width is the latest level.

Start uses a fixed session id `"dev-audio"`.

Tests: `npm run test:swift -w @waypoint/mobile` passes. There are no new TypeScript tests; the TypeScript side is types only.

Device check (iPhone; the simulator has no real microphone path):
1. Open `waypoint://dev/audio` (Safari, or `npx uri-scheme open waypoint://dev/audio --ios`). Tap Permission and allow. Tap Start and speak: the bar moves.
2. Lock the screen for 6 minutes, then unlock. Recording is still going, and an `onPart` for index 0 with `durationMs` ≈ 300000 arrived.
3. Call the phone from another phone. The state becomes `paused` with reason `interruption`. Hang up: it stays paused. Resume works.
4. Unplug wired headphones or disconnect AirPods during recording: paused with `route_change`.
5. Stop. Every part file exists and plays in the Files app (Documents is visible in Files only if the owner later turns on file sharing, so you can also check with `xcrun simctl`, or by listing the folder in Xcode's device window).

Not in this PR: speech (M6), any change to the database, the recording screen (M10b), playback, choosing the input device, Live Activity.

### M6 · Native: on-device speech to text (adds to `modules/waypoint-audio`)

Branch `pr/m6-speech`. No new npm dependencies. Files:
- `app.json`: one Info.plist key.
- `modules/Package.swift`: unchanged; `TranscriptPiece.swift` lands in the existing `AudioCore` target.
- `modules/waypoint-audio/ios/Core/TranscriptPiece.swift`, `ios/Tests/TranscriptPieceTests.swift`, `ios/LiveTranscriber.swift`, `ios/SpeechSetup.swift`.
- `ios/WaypointAudioModule.swift` and `src/WaypointAudio.ts`: additions only.
- `src/core/capture/transcript.ts`, `test/transcript.test.ts`.
- `src/app/dev/audio.tsx`: shows the transcript.

Why it looks like this:
- `SpeechAnalyzer` with `SpeechTranscriber` is Apple's iOS 26 on-device engine: long-form, offline, with volatile (in-progress) and final results. The system downloads the language model per locale through `AssetInventory`; that download is the "speech pack" of P11.
- Phones where `SpeechTranscriber.isAvailable` is false use `DictationTranscriber`, which has the same shape.
- The analyzer does not convert audio formats, so each tap buffer is converted to `SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith:)` with `AVAudioConverter`.
- If the speech pack is not installed yet, the recording still goes ahead ("your audio is safe either way"), and the parts are transcribed from their files afterwards with `transcribeFile`.
- `transcribeFile` is also the safety net if live transcription stops in the background. The iOS 27 release notes restrict background Neural Engine use; whether that touches SpeechAnalyzer is not confirmed. The device check below tests it.

`app.json`, `ios.infoPlist`: add `"NSSpeechRecognitionUsageDescription": "Waypoint turns your recording into text on this iPhone. Nothing is sent anywhere."`. Sources disagree on whether SpeechAnalyzer needs this key, and it costs nothing.

`ios/Core/TranscriptPiece.swift`, exactly. It was compiled and tested here:

```swift
import Foundation

/// What the speech module sends to JavaScript for one result.
struct TranscriptPiece: Equatable {
  let tStart: Int64
  let tEnd: Int64
  let text: String
  let isFinal: Bool

  /// `startSeconds`/`endSeconds` are the analyzer's times, counted from the start of the run.
  /// `runStartMs` is when the run started, in ms since the session started.
  /// Returns nil when the text is only whitespace.
  static func make(text: String, startSeconds: Double, endSeconds: Double, isFinal: Bool, runStartMs: Int64) -> TranscriptPiece? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    let start = runStartMs + Int64((max(0, startSeconds) * 1000).rounded())
    let end = max(start, runStartMs + Int64((max(0, endSeconds) * 1000).rounded()))
    return TranscriptPiece(tStart: start, tEnd: end, text: trimmed, isFinal: isFinal)
  }

  var event: [String: Any] {
    ["tStart": Double(tStart), "tEnd": Double(tEnd), "text": text, "isFinal": isFinal]
  }
}

enum LocaleChooser {
  /// Picks the first preferred language the transcriber supports. Identifiers may use "-" or "_".
  /// An exact match ("en-GB") wins; otherwise the first supported locale with the same language ("en").
  static func choose(preferred: [String], supported: [String]) -> String? {
    func norm(_ id: String) -> String { id.replacingOccurrences(of: "_", with: "-").lowercased() }
    func lang(_ id: String) -> String { String(norm(id).split(separator: "-").first ?? "") }
    for p in preferred {
      if let exact = supported.first(where: { norm($0) == norm(p) }) { return exact }
      if let same = supported.first(where: { lang($0) == lang(p) }) { return same }
    }
    return nil
  }
}
```

`ios/Tests/TranscriptPieceTests.swift` covers these cases, which passed here:
- `make(" hi there ", 1.2344, 2.0, true, runStartMs: 90_000)` → `(91_234, 92_000, "hi there", true)`.
- Whitespace-only text → nil.
- An end before the start → `tEnd == tStart`.
- `choose(["en-GB"], ["en_US", "en_GB"])` → `"en_GB"`.
- `choose(["en-AU", "fr-FR"], ["fr_FR", "en_US"])` → `"en_US"`.
- `choose(["xx"], ["en_US"])` → nil.

`ios/SpeechSetup.swift` is the speech pack and locale code. It needs iOS. The API names below are the iOS 26 ones; fix only compile errors.

```swift
import Speech

enum SpeechSetup {
  static var engine: String { SpeechTranscriber.isAvailable ? "transcriber" : "dictation" }

  static func chooseLocale() async -> Locale? {
    let supported = SpeechTranscriber.isAvailable
      ? await SpeechTranscriber.supportedLocales
      : await DictationTranscriber.supportedLocales
    guard let id = LocaleChooser.choose(preferred: Locale.preferredLanguages, supported: supported.map(\.identifier)) else { return nil }
    return Locale(identifier: id)
  }

  static func isInstalled(_ locale: Locale) async -> Bool {
    let installed = SpeechTranscriber.isAvailable
      ? await SpeechTranscriber.installedLocales
      : await DictationTranscriber.installedLocales
    return installed.contains { $0.identifier(.bcp47) == locale.identifier(.bcp47) }
  }

  /// One analysis module for this locale. `live` adds volatile results.
  static func makeModule(locale: Locale, live: Bool) -> any SpeechModule {
    let reporting: Set<SpeechTranscriber.ReportingOption> = live ? [.volatileResults] : []
    if SpeechTranscriber.isAvailable {
      return SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: reporting, attributeOptions: [.audioTimeRange])
    }
    let dictationReporting: Set<DictationTranscriber.ReportingOption> = live ? [.volatileResults] : []
    return DictationTranscriber(locale: locale, contentHints: [], transcriptionOptions: [], reportingOptions: dictationReporting, attributeOptions: [.audioTimeRange])
  }

  /// Downloads the speech pack, calling `progress` with 0...1 about twice a second.
  static func download(locale: Locale, progress: @escaping (Double) -> Void) async throws {
    let module = makeModule(locale: locale, live: false)
    guard let request = try await AssetInventory.assetInstallationRequest(supporting: [module]) else { return }
    let poll = Task {
      while !Task.isCancelled {
        progress(request.progress.fractionCompleted)
        try? await Task.sleep(for: .milliseconds(500))
      }
    }
    defer { poll.cancel() }
    try await request.downloadAndInstall()
    progress(1)
  }
}
```

If `DictationTranscriber` has no `supportedLocales` or `installedLocales` in the installed SDK, use `SpeechTranscriber`'s for both and note it in the pull request. If the option or protocol type names differ (`SpeechModule`, `ReportingOption`), use the SDK's names; the behaviour above is what matters.

`ios/LiveTranscriber.swift` is the `AudioBufferSink` that turns live buffers into `onTranscript` events. The rules:
- `configure(locale: Locale?) async`: stores the locale. When the locale is not nil, it also stores `await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module])`. Guard these two values with an `NSLock`; the recorder's io queue reads them.
- `runStarted(sessionId:runStartMs:format:)`:
  - If no locale or analyzer format is configured, set `missed = true` and return.
  - Otherwise create the module with `live: true`, then `SpeechAnalyzer(modules: [module])`, an `AVAudioConverter(from: format, to: analyzerFormat)`, and `AsyncStream<AnalyzerInput>.makeStream()`.
  - Start `Task { try await analyzer.start(inputSequence: stream) }`.
  - Start a second task that reads the results. `results` is not on the `SpeechModule` protocol, so branch on the concrete type: `if let t = module as? SpeechTranscriber { for try await result in t.results { ... } } else if let d = module as? DictationTranscriber { for try await result in d.results { ... } }`. The task calls `onEvent("onTranscript", ["sessionId": id] + piece.event)` for each result. Build each piece from `TranscriptPiece.make(text: String(result.text.characters), startSeconds: result.range.start.seconds, endSeconds: result.range.end.seconds, isFinal: result.isFinal, runStartMs:)`.
  - If either task throws, send `onSpeechError` with `["sessionId": id, "message": String(describing: error)]`.
- `append(_:)` converts with the standard one-shot converter block below and yields `AnalyzerInput(buffer: out)` when `out.frameLength > 0`:

```swift
let ratio = analyzerFormat.sampleRate / buffer.format.sampleRate
let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 1
guard let out = AVAudioPCMBuffer(pcmFormat: analyzerFormat, frameCapacity: capacity) else { return }
var fed = false
var error: NSError?
converter.convert(to: out, error: &error) { _, status in
  if fed { status.pointee = .noDataNow; return nil }
  fed = true
  status.pointee = .haveData
  return buffer
}
```

- `runEnded()`: calls `continuation.finish()`, then `Task { try? await analyzer.finalizeAndFinishThroughEndOfInput() }`, and clears the stored analyzer, converter and continuation.

`transcribeFile` lives in `SpeechSetup` (or a small `FileTranscriber`). It takes `(file: String, startMs: Double)` and returns the final pieces as `[[String: Any]]`:
1. Open `AVAudioFile(forReading:)` on `documents/file`.
2. Create the module with `live: false`, then `SpeechAnalyzer(modules: [module])`.
3. Collect the results with `async let`.
4. Run `if let last = try await analyzer.analyzeSequence(from: audioFile) { try await analyzer.finalizeAndFinish(through: last) } else { await analyzer.cancelAndFinishNow() }`.
5. Return the pieces with `isFinal` true, using `runStartMs = Int64(startMs)`.

If the pack is not installed it throws `Exception(name: "SpeechPack", description: "speech pack not installed", code: "speech_pack_missing")`.

`ios/WaypointAudioModule.swift` additions:
- `Events` gains `"onTranscript"`, `"onSpeechError"` and `"onSpeechPack"`.
- `private let transcriber = LiveTranscriber()`. In `OnCreate`, set `recorder.sink = transcriber`, point `transcriber.onEvent` at `sendEvent`, and start `Task { await self.transcriber.configure(locale: await SpeechSetup.installedLocale()) }`, where `installedLocale()` is `chooseLocale()` only when it is installed.
- `AsyncFunction("getSpeechStatus") { () async -> [String: Any] }` returns `["engine": SpeechSetup.engine, "locale": locale?.identifier ?? "", "pack": "installed" | "downloading" | "not_installed" | "unsupported"]`. It reports `"unsupported"` when `chooseLocale()` is nil and `"downloading"` while a download this module started is running.
- `AsyncFunction("downloadSpeechPack") { () async throws -> [String: Any] }` downloads, sending `onSpeechPack` `["fraction": Double]`. It then re-runs `transcriber.configure`, returns the new status, and does nothing if the pack is already installed.
- `AsyncFunction("transcribeFile") { (file: String, startMs: Double) async throws -> [[String: Any]] }`.

`src/WaypointAudio.ts` additions:

```ts
export type SpeechStatus = { engine: "transcriber" | "dictation"; locale: string; pack: "installed" | "downloading" | "not_installed" | "unsupported" };
export type TranscriptEvent = { sessionId: string; tStart: number; tEnd: number; text: string; isFinal: boolean };
export type TranscriptPiece = Omit<TranscriptEvent, "sessionId">;
// native methods: getSpeechStatus(): Promise<SpeechStatus>; downloadSpeechPack(): Promise<SpeechStatus>;
//                 transcribeFile(file: string, startMs: number): Promise<TranscriptPiece[]>
// events: onTranscript(TranscriptEvent), onSpeechError({ sessionId, message }), onSpeechPack({ fraction })
export const getSpeechStatus, downloadSpeechPack, transcribeFile, onTranscript, onSpeechError, onSpeechPackProgress
```

`src/core/capture/transcript.ts` is plain logic used by the recording screen (M10b) and the transcription queue:

```ts
export type Piece = { tStart: number; tEnd: number; text: string; isFinal: boolean };
export type LiveTranscript = { finals: Piece[]; volatile: Piece | null };
export const EMPTY_LIVE: LiveTranscript;
// A final replaces the volatile and is appended (ignored if a final with the same tStart is already there).
// A volatile replaces the previous volatile. Finals stay sorted by tStart.
export function addPiece(live: LiveTranscript, piece: Piece): LiveTranscript
export type PartSpan = { startMs: number; durationMs: number };
export type SegmentSpan = { tStart: number; tEnd: number };
// Parts at least `minMs` long that no segment overlaps, so they need transcribeFile.
// A segment overlaps when tStart < part end and tEnd > part start.
export function partsNeedingTranscription(parts: PartSpan[], segments: SegmentSpan[], minMs = 10_000): PartSpan[]
```

`test/transcript.test.ts`:
- A volatile then its final leaves one final and no volatile.
- A duplicate final (same `tStart`) is ignored.
- A final that arrives out of order is inserted in order.
- `partsNeedingTranscription`: one part covered, one not covered, one shorter than 10 s; a segment touching only the part's end edge does not count as overlapping.

Device check (iPhone):
1. In `waypoint://dev/audio`, show `getSpeechStatus()`. If the pack is `not_installed`, tap Download and watch the fraction reach 1.
2. Record 30 seconds of speech. Grey volatile text turns into final lines with times.
3. Lock the screen for 2 minutes while speaking near the phone, then unlock. Note whether finals arrived while locked, and paste the result in the pull request. That result decides whether M10b re-transcribes every part after a locked stretch.
4. Call `transcribeFile` on part 0. It returns finals whose times match the live ones within about a second.

Not in this PR: writing segments to the database (M10b), choosing the language in Settings, the second (cloud) transcript, custom vocabulary.

### M7 · Native: page camera and page reading (`modules/waypoint-pages`)

Branch `pr/m7-pages`. Dependencies: `expo-file-system` 58.0.13 (dev screen and later cards) and `zod` 4.6.7 (`parseLines`; if M8 merged first it is already there). Files: `apps/mobile/package.json`, `app.json` (one Info.plist key), `modules/Package.swift` (add the `PagesCore` pair), `modules/waypoint-pages/expo-module.config.json`, `index.ts`, `src/WaypointPages.ts`, `ios/WaypointPages.podspec` (same as M5's with `s.name = 'WaypointPages'` and its own summary), `ios/WaypointPagesModule.swift`, `ios/ScanDelegate.swift`, `ios/PageReader.swift`, `ios/PageStore.swift`, `ios/Core/PageLine.swift`, `ios/Tests/PageLineTests.swift`, `src/core/pages/blocks.ts`, `test/blocks.test.ts`, `src/app/dev/pages.tsx`.

Why it looks like this: VisionKit's document camera (`VNDocumentCameraViewController`) already does what T2 asks for — the camera stays open, edges are found and the page is flattened automatically, many pages per session, a running count, Done — with no camera code of ours. It cannot be restyled (Apple offers only `delegate` and `isSupported`), so it will not look exactly like T2; see Open questions. Text is read with Vision's `RecognizeTextRequest` (accurate, language correction, automatic language), which returns each line with a box; the boxes let "Help me with a problem" (M11b) find the problem the student taps. Pages and photos from the picker are stored as JPEG files in `Documents/sessions/<session>/`, and only the relative path goes into the database.

`app.json`, `ios.infoPlist`: `"NSCameraUsageDescription": "Waypoint uses the camera to snap pages of homework and books. Pages are read on this iPhone."`.

`modules/Package.swift`: add `.target(name: "PagesCore", path: "waypoint-pages/ios/Core")` and `.testTarget(name: "PagesCoreTests", dependencies: ["PagesCore"], path: "waypoint-pages/ios/Tests")`.

`ios/Core/PageLine.swift`, exactly (compiled and tested here):

```swift
import Foundation

/// One line of text found on a page. The box is in 0...1 page units with the origin at the top left.
struct PageLine: Equatable {
  let text: String
  let x: Double
  let y: Double
  let width: Double
  let height: Double

  /// Vision gives boxes with the origin at the bottom left. Values are clamped to 0...1 and rounded to 4 places.
  static func fromVision(text: String, x: Double, y: Double, width: Double, height: Double) -> PageLine? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    func r(_ v: Double) -> Double { (min(1, max(0, v)) * 10_000).rounded() / 10_000 }
    return PageLine(text: trimmed, x: r(x), y: r(1 - y - height), width: r(width), height: r(height))
  }

  /// Reading order: top to bottom; lines whose tops are within half a line height count as one row, left to right.
  static func readingOrder(_ lines: [PageLine]) -> [PageLine] {
    lines.sorted { a, b in
      let tolerance = min(a.height, b.height) / 2
      if abs(a.y - b.y) <= tolerance { return a.x < b.x }
      return a.y < b.y
    }
  }

  var dictionary: [String: Any] { ["text": text, "x": x, "y": y, "width": width, "height": height] }
}
```

`ios/Tests/PageLineTests.swift` (Swift Testing): `fromVision(" 3x + 7 = 22 ", 0.1, 0.8, 0.5, 0.05)` → `("3x + 7 = 22", 0.1, 0.15, 0.5, 0.05)`; blank text → nil; `x` −0.1 clamps to 0; three lines "right" (0.6, 0.101), "left" (0.1, 0.1), "below" (0.1, 0.2), height 0.04, sort to left, right, below.

`ios/PageStore.swift` (needs iOS):
- `static let documents: URL` as in M5; `static func newPagePath(sessionId: String) -> String` → `"sessions/<id>/page-<UUID>.jpg"` (creates the folder).
- `static func save(_ image: UIImage, sessionId: String) throws -> [String: Any]`: scales so the longest side is at most 2048 px with `UIGraphicsImageRenderer` (format scale 1; drawing also makes the image upright), writes `jpegData(compressionQuality: 0.8)`, returns `["file": path, "width": Double, "height": Double]`.
- `static func importImage(sessionId: String, sourceUri: String) throws -> [String: Any]`: `URL(string: sourceUri)`, `UIImage(contentsOfFile: url.path)`, then `save`. Missing or unreadable file → `Exception(name: "Pages", description: "could not read the picked image", code: "bad_image")`.

`ios/ScanDelegate.swift` (needs iOS): an `NSObject` that is the `VNDocumentCameraViewControllerDelegate` and takes `sessionId` and `done: (Result<[[String: Any]], Error>) -> Void`. `didFinishWith scan`: on a background queue, `PageStore.save(scan.imageOfPage(at: i), sessionId:)` for `i in 0..<scan.pageCount` in order, then call `done(.success(pages))` on the main queue. `documentCameraViewControllerDidCancel` → `done(.success([]))`. `didFailWithError` → `done(.failure(error))`.

`ios/PageReader.swift` (needs iOS):

```swift
import Vision

enum PageReader {
  static func read(file: String) async throws -> [String: Any] {
    let url = PageStore.documents.appendingPathComponent(file)
    var request = RecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.automaticallyDetectsLanguage = true
    let observations = try await request.perform(on: url)
    let lines = observations.compactMap { o -> PageLine? in
      guard let text = o.topCandidates(1).first?.string else { return nil }
      let r = o.boundingBox.cgRect
      return PageLine.fromVision(text: text, x: r.origin.x, y: r.origin.y, width: r.width, height: r.height)
    }
    let ordered = PageLine.readingOrder(lines)
    return ["text": ordered.map(\.text).joined(separator: "\n"), "lines": ordered.map(\.dictionary)]
  }
}
```

If `NormalizedRect` has no `cgRect` in the SDK, use its `origin`/`width`/`height` (normalized, lower-left origin) and say so in the pull request.

`ios/WaypointPagesModule.swift`:

```swift
import ExpoModulesCore
import VisionKit

public class WaypointPagesModule: Module {
  private var scan: ScanDelegate?

  public func definition() -> ModuleDefinition {
    Name("WaypointPages")

    Function("isScannerSupported") { () -> Bool in VNDocumentCameraViewController.isSupported }

    AsyncFunction("scanPages") { (sessionId: String, promise: Promise) in
      guard self.scan == nil else { promise.reject("busy", "The camera is already open"); return }
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject("no_view", "Nothing to show the camera from"); return
      }
      let camera = VNDocumentCameraViewController()
      let delegate = ScanDelegate(sessionId: sessionId) { [weak self] result in
        camera.dismiss(animated: true)
        self?.scan = nil
        switch result {
        case .success(let pages): promise.resolve(pages)
        case .failure(let error): promise.reject("scan_failed", error.localizedDescription)
        }
      }
      self.scan = delegate
      camera.delegate = delegate
      presenter.present(camera, animated: true)
    }.runOnQueue(.main)

    AsyncFunction("readPage") { (file: String) async throws -> [String: Any] in try await PageReader.read(file: file) }

    AsyncFunction("importImage") { (sessionId: String, sourceUri: String) throws -> [String: Any] in
      try PageStore.importImage(sessionId: sessionId, sourceUri: sourceUri)
    }
  }
}
```

`src/WaypointPages.ts` (same pattern as M5, `index.ts` re-exports it):

```ts
export type ScannedPage = { file: string; width: number; height: number };
export type PageLine = { text: string; x: number; y: number; width: number; height: number };
export type PageText = { text: string; lines: PageLine[] };
export const isScannerSupported: () => boolean;
export const scanPages: (sessionId: string) => Promise<ScannedPage[]>;   // [] when cancelled
export const readPage: (file: string) => Promise<PageText>;
export const importImage: (sessionId: string, sourceUri: string) => Promise<ScannedPage>;
```

`src/core/pages/blocks.ts` — groups a page's lines (already in reading order) into blocks a student can tap:

```ts
export type Line = { text: string; x: number; y: number; width: number; height: number };
export type Block = { text: string; x: number; y: number; width: number; height: number; lines: number };
export const PROBLEM_START = /^\(?(\d{1,3}|[a-z])[.)]\s/i;
export function groupBlocks(lines: Line[]): Block[]
export function parseLines(json: string | null): Line[]   // captures.found_lines; bad or missing JSON → []
```

`groupBlocks` rules: walk the lines in order; start a new block when (a) it is the first line, (b) the line matches `PROBLEM_START`, (c) the gap from the previous line's bottom to this line's top is more than 1.2 × the median line height of the page, or (d) the line's `x` differs from the block's first line's `x` by more than 0.15 and the line does not sit on the same row (tops within half a height). The block's box is the union of its lines' boxes; `text` joins the lines with a space. `parseLines` checks each item has a string `text` and numeric `x`, `y`, `width`, `height` in 0..1 (zod), and drops bad items.

Tests (`test/blocks.test.ts`): the T2 page (title line, "1. 3x + 7 = 22", "2. 2(x − 4) = 10", "3. x ÷ 5 + 3 = 9", "4. A train leaves at 9:40 and" + "travels 150 km at 60 km/h." + "When does it arrive?") gives 5 blocks with problem 4 as one three-line block; a big vertical gap splits a paragraph; "a) ..." starts a block; union box is right; `parseLines("nope")` → `[]`; an item with `x: 2` is dropped; empty input → `[]`.

`src/app/dev/pages.tsx` (`waypoint://dev/pages`): buttons Scan (session id `"dev-pages"`) and Read first page; shows thumbnails (`Image` with `new File(Paths.document, file).uri` from `expo-file-system`) and the read text with its block count.

Device check (iPhone): scanning 3 pages returns 3 files in order; cancel returns `[]`; reading a printed worksheet returns its lines in reading order; a page held at an angle still reads; `isScannerSupported()` is false in the simulator.

Not in this PR: the T2/T4 screens (M10c), the photo picker (M10c), handwriting-specific tuning, `RecognizeDocumentsRequest` tables and lists, deleting files.

### M8 · Native: on-device model for flashcards, quiz and help (`modules/waypoint-model`)

Branch `pr/m8-model`. Dependencies: `zod` 4.6.7 (if M7 merged first it is already there). Files: `apps/mobile/package.json`, `modules/waypoint-model/expo-module.config.json`, `index.ts`, `src/WaypointModel.ts`, `ios/WaypointModel.podspec` (as M5, `s.name = 'WaypointModel'`), `ios/WaypointModelModule.swift`, `ios/Drafts.swift`, `ios/ModelErrors.swift`, `src/core/study/drafts.ts`, `src/core/study/generate.ts`, `test/drafts.test.ts`, `test/generate.test.ts`, `src/app/dev/model.tsx`.

Why it looks like this: section 2 puts flashcards, quiz and "Help me with a problem" on the iPhone, free. Apple's Foundation Models framework gives an on-device model with guided generation (`@Generable` Swift types), so the model fills typed fields instead of free text. Its context window is 4,096 tokens shared by instructions, input and output, so long notes are split and cards are made per piece (read `contextSize` at runtime; do not hard-code it). Output from any model is checked in TypeScript before it is saved. On phones without Apple Intelligence the module says why, and the Study screens show that reason (M11a); there is no fallback model in stage 1.

`ios/Drafts.swift` (needs iOS 26 SDK):

```swift
import FoundationModels

let studyInstructions = """
You help a school student study their own notes. Use only the text you are given. \
Do not add facts that are not in the text. Write short, plain sentences at the reading level of the text.
"""

@Generable enum DraftKind { case term, problem }

@Generable struct CardDraft {
  @Guide(description: "term for a word or idea and what it means; problem for a worked problem from the text")
  var kind: DraftKind
  @Guide(description: "The front of the card: the term, or the problem to solve")
  var front: String
  @Guide(description: "The back: what the term means in one or two sentences, or the steps and the answer")
  var back: String
}

@Generable struct CardSet {
  @Guide(description: "The flashcards, most important first")
  var cards: [CardDraft]
}

@Generable struct QuizDraft {
  var question: String
  @Guide(description: "Exactly four answer choices, only one of them right")
  var choices: [String]
  @Guide(description: "Position of the right choice, from 0 to 3")
  var answerIndex: Int
  @Guide(description: "One sentence saying why the right answer is right")
  var why: String
}

@Generable struct QuizSet { var questions: [QuizDraft] }

@Generable struct HelpStepDraft {
  @Guide(description: "A short name for this step")
  var title: String
  @Guide(description: "What to do in this step and why. Do not give the final answer here.")
  var detail: String
}

@Generable struct ProblemHelpDraft {
  @Guide(description: "The steps to solve the problem, in order, two to six of them")
  var steps: [HelpStepDraft]
  @Guide(description: "The final answer")
  var answer: String
}
```

`ios/ModelErrors.swift`: `func modelErrorCode(_ error: Error) -> String`. For `LanguageModelSession.GenerationError` (iOS 26): `.exceededContextWindowSize` → `"context_too_long"`, `.guardrailViolation` and `.refusal` → `"declined"`, `.rateLimited` and `.concurrentRequests` → `"busy"`, `.unsupportedLanguageOrLocale` → `"unsupported_language"`, `.assetsUnavailable` → `"unavailable"`, anything else → `"failed"`. Then `if #available(iOS 27, *)` the same mapping for `LanguageModelError` (`.contextSizeExceeded`, `.guardrailViolation`, `.refusal`, `.rateLimited`, `.unsupportedLanguageOrLocale`, `default`). The iOS 26 enum is deprecated in the iOS 27 SDK; keep both. If a case name does not exist in the installed SDK, drop that line and say so.

`ios/WaypointModelModule.swift`:
- `Function("getAvailability") -> String`: `SystemLanguageModel.default.availability` → `"available"`, or for `.unavailable(reason)`: `.deviceNotEligible` → `"device_not_eligible"`, `.appleIntelligenceNotEnabled` → `"apple_intelligence_off"`, `.modelNotReady` → `"model_not_ready"`, other → `"unavailable"`.
- `Function("getContextSize") -> Int`: `SystemLanguageModel.default.contextSize`.
- `AsyncFunction("makeCards") { (text: String, max: Int) async throws -> [[String: Any]] }`: a new `LanguageModelSession(instructions: studyInstructions)`, `respond(to: "Make up to \(max) flashcards from this text.\n\nText:\n\(text)", generating: CardSet.self)`, map to `["kind": "term"|"problem", "front", "back"]`.
- `AsyncFunction("makeQuiz") { (text: String, count: Int) ... }` with `QuizSet` → `["question", "choices", "answerIndex", "why"]`.
- `AsyncFunction("helpWithProblem") { (problem: String, context: String) ... -> [String: Any] }` with prompt `"Help me solve this problem step by step.\n\nProblem:\n\(problem)\n\nThe page it is on:\n\(context)"` and `ProblemHelpDraft` → `["steps": [["title", "detail"]], "answer"]`.
- Every async function wraps its body in `do { ... } catch { throw Exception(name: "Model", description: String(describing: error), code: modelErrorCode(error)) }`; `Exception(name:description:code:)` is the Expo Modules initializer, and JavaScript sees `error.code`.
- One request at a time: keep a `var busy = false` guarded by an `NSLock`; a second call while busy throws code `"busy"`.

`src/WaypointModel.ts`:

```ts
export type ModelAvailability = "available" | "device_not_eligible" | "apple_intelligence_off" | "model_not_ready" | "unavailable";
export const getAvailability: () => ModelAvailability;
export const getContextSize: () => number;
export const makeCards: (text: string, max: number) => Promise<unknown>;
export const makeQuiz: (text: string, count: number) => Promise<unknown>;
export const helpWithProblem: (problem: string, context: string) => Promise<unknown>;
```

The promises are `unknown` on purpose: `src/core/study/drafts.ts` checks them.

`src/core/study/drafts.ts` (zod; plain core):

```ts
export type CardDraft = { kind: "term" | "problem"; front: string; back: string };
export type QuizDraft = { question: string; choices: [string, string, string, string]; answerIndex: 0 | 1 | 2 | 3; why: string };
export type HelpDraft = { steps: { title: string; detail: string }[]; answer: string };
export function cleanCards(raw: unknown, max: number): CardDraft[]
export function cleanQuiz(raw: unknown, count: number): QuizDraft[]
export function cleanHelp(raw: unknown): HelpDraft | null
```

Rules: anything that is not the expected shape is dropped item by item (a non-array → `[]`/`null`); strings are trimmed and collapsed to single spaces; empty fronts, backs, questions or answers are dropped; fronts over 200 and backs over 1,000 characters are cut at a word boundary with "…"; cards with the same front (case-insensitive, ignoring punctuation) keep the first; at most `max` cards. A quiz item needs exactly 4 non-empty, distinct choices and `answerIndex` 0–3, else it is dropped; at most `count`. Help needs 1–8 steps with non-empty title and detail and a non-empty answer, else `null`; steps over 8 are cut to 8.

`src/core/study/generate.ts`:

```ts
export type ModelPort = {
  contextSize(): number;
  makeCards(text: string, max: number): Promise<unknown>;
  makeQuiz(text: string, count: number): Promise<unknown>;
};
export type Unit = { text: string; captureId: string | null; t: number | null };  // one page, or a stretch of transcript
export type SourcedCard = CardDraft & { captureId: string | null; t: number | null };
export function estimateTokens(text: string): number            // Math.ceil(text.length / 3)
export function inputBudget(contextSize: number): number        // contextSize - 1500, at least 500
export function packUnits(units: Unit[], budgetTokens: number): Unit[][]
export async function makeCardsFromUnits(port: ModelPort, units: Unit[], maxTotal: number): Promise<SourcedCard[]>
export async function makeQuizFromUnits(port: ModelPort, units: Unit[], count: number): Promise<QuizDraft[]>
```

- `packUnits` keeps order and puts consecutive units into a group while the group's estimated tokens stay within the budget. A single unit over the budget is split at sentence ends (`. `, `? `, `! `, newline) into parts that fit (each part keeps the unit's `captureId`/`t`); a sentence longer than the budget is cut by characters.
- `makeCardsFromUnits`: for each group in order, ask for `ceil(maxTotal × groupTokens / allTokens)` cards (at least 1), clean them, and give each card the `captureId`/`t` of the first unit in the group whose text contains the card's front (case-insensitive), else the group's first unit. Stop when `maxTotal` is reached. A group whose call throws an error with `code` `"context_too_long"` is split in half once and retried; any other error is rethrown. Duplicate fronts across groups keep the first.
- `makeQuizFromUnits`: same spreading of `count` across groups; quiz items are not sourced.

Tests use a fake `ModelPort` that records what it was asked:
- `drafts.test.ts`: every cleaning rule above.
- `generate.test.ts`: packing keeps order and fits; one huge unit is split at sentences; card counts are spread by size and capped; sourcing picks the page whose text contains the front; `context_too_long` splits once and succeeds; a second `context_too_long` on a half is rethrown; another error is rethrown; duplicates across groups are dropped.

`src/app/dev/model.tsx` (`waypoint://dev/model`): shows availability and context size; a text box and buttons Cards, Quiz, Help that print the cleaned results.

Device check (iPhone 15 Pro or later with Apple Intelligence on; and one older phone or Apple Intelligence off): availability strings are right on both; 2,000 characters of a textbook page give terms and problems; a 30,000-character transcript through `makeCardsFromUnits` finishes without a context error; `helpWithProblem("3x + 7 = 22", ...)` gives steps whose details do not state x = 5 and an answer of 5. Record how long 12 cards take, in the pull request.

Not in this PR: the Study screens (M11a, M11b), any cloud fallback, streaming partial results, image input (iOS 27), saving anything.

### M9a · Native and core: search index (`modules/waypoint-embed`)

Branch `pr/m9a-search-index`. No new npm dependencies. Files: `modules/waypoint-embed/expo-module.config.json`, `index.ts`, `src/WaypointEmbed.ts`, `ios/WaypointEmbed.podspec` (as M5, `s.name = 'WaypointEmbed'`), `ios/WaypointEmbedModule.swift`, `src/core/search/vectors.ts`, `src/core/search/chunks.ts`, `src/core/search/fts.ts`, `src/core/search/indexer.ts`, `src/core/search/query.ts`, `test/vectors.test.ts`, `test/chunks.test.ts`, `test/fts.test.ts`, `test/indexer.test.ts`, `test/query.test.ts`.

Why it looks like this: search runs and stays on the iPhone ("The index never leaves the device"). It is hybrid: SQLite FTS5 (compiled into expo-sqlite by default) finds exact words, and sentence vectors find meaning. Vectors come from Apple's `NLEmbedding.sentenceEmbedding(for:)` — on device, no download step, and Apple recommends it over `NLContextualEmbedding` for similarity. Because sqlite-vec does not load on iOS in expo-sqlite 58, vectors are stored as int8 BLOBs (L2-normalised, one scale per vector) in `search_index` and compared in TypeScript; a year of notes is about 12,000 chunks × 512 bytes, which Hermes scores in tens of milliseconds. The two rankings are merged with reciprocal rank fusion. Each vector records `model_version`; when Apple's model changes, stale vectors are rebuilt (K5 "Index updates").

`ios/WaypointEmbedModule.swift`:

```swift
import ExpoModulesCore
import NaturalLanguage

public class WaypointEmbedModule: Module {
  private func embedding() -> (NLEmbedding, NLLanguage)? {
    let preferred = NLLanguage(rawValue: String(Locale.preferredLanguages.first?.prefix(2) ?? "en"))
    if let e = NLEmbedding.sentenceEmbedding(for: preferred) { return (e, preferred) }
    if let e = NLEmbedding.sentenceEmbedding(for: .english) { return (e, .english) }
    return nil
  }

  public func definition() -> ModuleDefinition {
    Name("WaypointEmbed")

    Function("getModel") { () -> [String: Any] in
      guard let (e, lang) = self.embedding() else { return ["available": false, "modelVersion": "", "dimension": 0] }
      return ["available": true, "modelVersion": "nl-sentence:\(lang.rawValue):\(e.revision)", "dimension": e.dimension]
    }

    AsyncFunction("embed") { (texts: [String]) -> [[Double]] in
      guard let found = self.embedding() else { throw Exception(name: "Embed", description: "no sentence embedding", code: "unavailable") }
      let e = found.0
      return texts.map { e.vector(for: $0) ?? [] }
    }
  }
}
```

An empty array means "no vector for this text". `src/WaypointEmbed.ts`: `getModel(): { available: boolean; modelVersion: string; dimension: number }`, `embed(texts: string[]): Promise<number[][]>`.

`src/core/search/vectors.ts`, exactly (tested here):

```ts
// Vectors are stored as int8 with one scale per vector, after L2 normalisation.
export type StoredVector = { scale: number; bytes: Uint8Array };

export function quantize(vector: readonly number[]): StoredVector {
  let norm = 0;
  for (const v of vector) norm += v * v;
  norm = Math.sqrt(norm);
  if (vector.length === 0 || norm === 0) throw new RangeError("empty or zero vector");
  let maxAbs = 0;
  for (const v of vector) maxAbs = Math.max(maxAbs, Math.abs(v / norm));
  const scale = maxAbs / 127;
  const q = new Int8Array(vector.length);
  for (let i = 0; i < vector.length; i++) q[i] = Math.round((vector[i] ?? 0) / norm / scale);
  return { scale, bytes: new Uint8Array(q.buffer) };
}

// Cosine similarity of two stored vectors of the same length (about -1 to 1).
export function similarity(a: StoredVector, b: StoredVector): number {
  if (a.bytes.length !== b.bytes.length) throw new RangeError("dimension mismatch");
  const x = new Int8Array(a.bytes.buffer, a.bytes.byteOffset, a.bytes.length);
  const y = new Int8Array(b.bytes.buffer, b.bytes.byteOffset, b.bytes.length);
  let dot = 0;
  for (let i = 0; i < x.length; i++) dot += (x[i] ?? 0) * (y[i] ?? 0);
  return dot * a.scale * b.scale;
}

// Reciprocal rank fusion of ranked id lists: score(id) = sum of 1 / (k + rank), rank starting at 1.
export function fuse(lists: readonly (readonly number[])[], k = 60): number[] {
  const scores = new Map<number, number>();
  for (const list of lists) list.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...scores.entries()].sort((p, q) => q[1] - p[1] || p[0] - q[0]).map(([id]) => id);
}
```

`src/core/search/chunks.ts`:

```ts
export type ChunkDraft = { source: "transcript" | "page" | "photo"; captureId: string | null; tStart: number; tEnd: number; text: string };
export const CHUNK_WORDS = 120;
export function chunkTranscript(segments: { tStart: number; tEnd: number; text: string }[]): ChunkDraft[]
export function chunkCapture(capture: { id: string; kind: "page" | "photo"; t: number; text: string }): ChunkDraft[]
```

`chunkTranscript` walks segments in time order, adding whole segments to the current chunk until it would pass `CHUNK_WORDS` words (a single segment longer than that is its own chunk); `tStart`/`tEnd` are the first and last segment's times; `captureId` null. `chunkCapture` splits the text at blank lines into paragraphs, then packs paragraphs the same way (a paragraph over the limit is split by words); `tStart = tEnd = t`. Empty text → no chunks.

`src/core/search/fts.ts`: `export function toFtsQuery(input: string): string | null` — words are `input.match(/[\p{L}\p{N}]+/gu)`; none → `null`; each word is wrapped in double quotes, the last one gets a `*` (prefix match while typing), joined with spaces (FTS5 implicit AND). Never pass user text to `MATCH` any other way.

`src/core/search/indexer.ts`:

```ts
export type Embedder = { modelVersion: string; embed(texts: string[]): Promise<number[][]> };
export function sessionsToIndex(db: SqlDb, limit: number): string[]   // state = 'saved' AND indexed_at IS NULL, oldest first
export async function indexSession(db: SqlDb, embedder: Embedder, sessionId: string, now: number): Promise<number>  // chunks written
export function markStale(db: SqlDb, modelVersion: string): number   // sessions with any vector of another model_version get indexed_at = NULL; returns count
export function indexStatus(db: SqlDb, modelVersion: string): { sessions: number; indexed: number; chunks: number; vectors: number }
```

`indexSession`: read the session's `device` segments and its page/photo captures with `found_text`; build chunks; embed all texts in batches of 16 (await each batch; do not hold a transaction across `await`); then in one `db.transaction`: delete the session's chunks (the cascade clears vectors and FTS rows), insert the new chunks, insert a `search_index` row for each chunk whose vector is non-empty (`quantize`), and set `indexed_at = now`. If the session changed while embedding (its `indexed_at` is no longer NULL or it no longer exists), write nothing and return 0. A chunk whose vector is empty is still inserted (keyword search still finds it).

`src/core/search/query.ts`:

```ts
export type Hit = { chunkId: number; sessionId: string; sessionTitle: string; spaceName: string; tStart: number; captureId: string | null; snippet: string };
export async function searchNotes(db: SqlDb, embedder: Embedder, query: string, options: { spaceId?: string; limit?: number }): Promise<Hit[]>
```

Steps: `toFtsQuery`; if `null`, return `[]`. Keyword list: `SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT 50`. Vector list: embed the query; if the vector is empty skip; otherwise score every `search_index` row with the current `model_version` (filtered to the space when given) and keep the top 50 with similarity ≥ 0.25. `fuse([keyword, vector])`, take `limit` (default 20), and load each hit with its session title and space name. `snippet`: for a keyword hit, `snippet(chunks_fts, 0, '[', ']', '…', 12)` (the screen bolds the bracketed words); otherwise the first 140 characters of the chunk. Cache the loaded vectors in a module-level `Map` keyed by `model_version`, cleared whenever `indexSession` writes (export `clearVectorCache()` and call it there).

Tests (memory database from M4, fake embedder returning fixed vectors by keyword):
- `vectors.test.ts`: `[1,2,3]` vs `[2,4,6]` ≈ 1 (2 places), vs its negative ≈ −1, orthogonal ≈ 0, zero vector throws, length mismatch throws, `fuse([[1,2,3],[3,1]])` = `[1,3,2]`.
- `chunks.test.ts`: segments packed under 120 words; a 300-word segment alone; times; paragraphs; empty text.
- `fts.test.ts`: `"deadweight loss"` → `"deadweight" "loss"*`; quotes, `*`, `-`, `NEAR` and `"` in input never reach FTS as syntax; `"!!!"` → null.
- `indexer.test.ts`: a saved session with segments and a page is indexed (chunks, vectors, FTS rows, `indexed_at`); re-indexing replaces rather than duplicates; a recording session (`state = 'recording'`) is not picked; `markStale` with a new model version flags the session; empty vectors still store the chunk; a session deleted during embedding writes nothing.
- `query.test.ts`: a keyword-only hit, a meaning-only hit (fake vectors close), both merged in fused order, space filter, `limit`, snippet brackets, empty query → `[]`, and that the vector cache is refreshed after `indexSession`.

Device check: `getModel()` on an English iPhone returns `available: true` and a dimension (write it in the pull request); `embed(["supply and demand", "price of goods"])` returns two vectors whose similarity (via `quantize`) is higher than with `"photosynthesis"`.

Not in this PR: the Search screen and running the indexer (M9b), Ask (H3), sqlite-vec, indexing explanations or terms.

### M9b · Search screen and the background indexer

Branch `pr/m9b-search-screen`. No new dependencies. Files: `src/platform/indexer.ts`, `src/features/search/SearchScreen.tsx`, `src/app/(tabs)/search.tsx`, `src/app/(tabs)/_layout.tsx` (one hook call).

`src/platform/indexer.ts`: `export function useIndexer(): void`, called once in `(tabs)/_layout.tsx`. While the app is active (`AppState`), every 20 seconds and right after the app becomes active: if `getModel().available`, run `markStale` once per launch, then `indexSession` for up to 3 sessions from `sessionsToIndex`, one at a time, through `writeDb`-aware calls so screens refresh. Never run two ticks at once. Errors are swallowed and retried on the next tick (no `console.log`).

`src/features/search/SearchScreen.tsx` (H1, H2, P8 — Search only, no Ask):
- Title "Search"; field placeholder "Search your notes" (H1 shows "Search or ask"; Ask is stage 2), search runs 250 ms after typing stops.
- Empty field and no sessions yet (P8, reworded because Ask is not in stage 1): search icon, title "Find anything you recorded or snapped", body "Record something or snap a page first, then find it here."
- Results: each row shows the session title, space name, `formatOffset(tStart)` for transcript hits or "Page" for page hits, and the snippet with bracketed words in bold. Tapping opens `/session/<id>?t=<tStart>` (route made in M10c; until then it shows Expo Router's unmatched screen).
- No results: "Nothing found for “{query}”."
- Footer line in `local` colour with a phone glyph: "Search runs on this iPhone."

Device check: after M10b/M10c exist, a word said in a recording is found within a minute of saving; a word on a snapped page is found; Airplane Mode changes nothing.

Not in this PR: Ask (H3), scope filters (H4), voice search.

### M10a · Capture: Home, spaces and the "Saving to" pill

Branch `pr/m10a-home-spaces`. No new dependencies. Files: `src/core/capture/sessions.ts`, `src/core/capture/labels.ts`, `test/sessions.test.ts`, `test/labels.test.ts`, `src/features/capture/HomeScreen.tsx`, `src/features/capture/SavingToPill.tsx`, `src/features/capture/SpacePickerScreen.tsx`, `src/features/capture/NewSpaceScreen.tsx`, `src/features/capture/SpacesScreen.tsx`, `src/features/capture/SpaceScreen.tsx`, `src/ui/kit.tsx`, routes `src/app/(tabs)/index.tsx`, `src/app/(tabs)/spaces.tsx`, `src/app/space-picker.tsx`, `src/app/new-space.tsx`, `src/app/space/[id].tsx`, and `src/app/_layout.tsx` (register the new routes inside the signed-in guard: `space-picker` and `new-space` with `presentation: "formSheet"`, `space/[id]` as a card).

Why it looks like this: T1 and T1b, agreed on 2026-11-16 — Home has two equal starts, Record and Snap pages, with "From Photos" under them, and a "Saving to" pill above them that is always filled (My notes, then the last-used space) so it never blocks a capture. There is no kid mode or parent mode and nothing says "lecture". "Paste a link" needs the cloud (`read_link`) and is left out of stage 1.

`src/ui/kit.tsx` — small shared pieces used by every feature from here on, all using `useColors()`: `Screen` (safe-area padded, `bg`, scrolls), `Title` (serif look: `fontFamily: "Georgia"`, 32, weight 700 — the design's serif is not bundled in stage 1), `Body`, `Caption` (`ink3`, 13), `PrimaryButton` (`accent` fill, `onAccent` text, radius 16, min height 52), `SecondaryButton` (`surface2` fill, `ink` text), `Row` (pressable list row with title, subtitle, right accessory), `OnDeviceNote` (a `local`-coloured line with an `iphone` SF Symbol and the given text). Every pressable has `accessibilityRole="button"` and a label.

`src/core/capture/sessions.ts`:

```ts
export type SessionKind = "recording" | "pages";
export type SessionState = "recording" | "paused" | "saved" | "interrupted";
export type SessionRow = { id: string; spaceId: string; kind: SessionKind; title: string; state: SessionState; transcript: string; startedAt: number; endedAt: number | null; recordedMs: number };
export type SessionSummary = SessionRow & { spaceName: string; pages: number; photos: number; flags: number; cards: number };
export function createSession(db: SqlDb, deps: { now: () => number; newId: () => string }, input: { spaceId: string; kind: SessionKind; title: string; state: SessionState }): SessionRow
export function getSession(db: SqlDb, id: string): SessionRow | null
export function latestSession(db: SqlDb): SessionSummary | null          // newest saved or interrupted session
export function sessionsInSpace(db: SqlDb, spaceId: string): SessionSummary[]   // newest first, saved and interrupted only
export function renameSession(db: SqlDb, id: string, title: string): void      // trimmed, 1..80 chars else RangeError
export function moveSession(db: SqlDb, id: string, spaceId: string, now: number): void  // also touches the space
export function deleteSessionRow(db: SqlDb, id: string): void            // cascades; files are removed by the caller
```

`src/core/capture/labels.ts`: `usedLabel(lastUsedAt: number, now: number, timeZoneOffsetMin: number): string | null` → "Used today", "Used yesterday" or `null`, by calendar day in the given offset; `sessionsLabel(n)` → "1 session" / "{n} sessions"; `greeting(hour: number)` → "Good morning" (5–11), "Good afternoon" (12–17), "Good evening" otherwise; `dateLine(ms, offsetMin)` → e.g. "THURSDAY, NOV 19".

Screens:
- **Home** (`HomeScreen`): `dateLine` in caption caps, then "{greeting}, {firstName}" (`useProfile()` from M1b) with an avatar circle showing the initial (orange `#EE7B3B`) that opens `/settings`. If `latestSession` is null (T1): "Start with a class or a page." and "Record what you hear, or snap homework and book pages." Otherwise a card for the latest session (B1, simplified): space name, title, `formatClock(recordedMs)` or "{n} pages", chips for flags/photos/pages counts that are above 0, and "Open session" → `/session/<id>`. Under either: "Saving to" + `SavingToPill`, then two big buttons side by side — **Record** ("A class or a talk", `rec` fill, `onRec` text, mic symbol) → `/record`, **Snap pages** ("Homework, books", `accent` fill, camera symbol) → `/pages/new` — then a full-width secondary "From Photos" → `/pages/new?from=photos`.
- **SavingToPill**: folder symbol, the `getSavingTo` space name, chevron; opens `/space-picker`.
- **Space picker** (T1b, form sheet): title "Where should this go?"; rows from `listSpaces`, each with a folder tile, the name, and a subtitle — for the default space "Everything not in a space yet", otherwise `usedLabel` and `sessionsLabel` joined by " · " (whichever exist); a check on the current one. Tapping a row calls `setSavingTo` and closes. "New space" (accent-soft button with +) → `/new-space`. Footer: "Not sure? Leave it in My notes. You can move it any time." When opened with `?sessionId=` (from M10c), tapping a row calls `moveSession` instead and does not change the saved default.
- **New space** (form sheet): title "New space", one field (placeholder "Math, Science, History…", max 60), "Create". Errors: empty → "Give it a name."; taken → "You already have a space called {name}." Creating also sets it as "Saving to" and closes both sheets.
- **Spaces tab** (F1, simplified): title "Spaces", rows for each space with `sessionsLabel`; tap → `/space/<id>`.
- **Space** (F2, simplified): the space name, then `sessionsInSpace` rows: mic or doc symbol, title, date ("Nov 19"), and `formatClock` or "{n} pages"; tap → `/session/<id>`. Empty: "Nothing here yet. Things you save to {name} show up here."

All reads go through `useQuery`, all writes through `writeDb` (M4), so lists refresh after changes.

Tests: `sessions.test.ts` — create/get, `latestSession` skips `recording` and picks the newest, summary counts (pages, photos, flags, cards), order in `sessionsInSpace`, rename limits, move touches the space, delete cascades; `labels.test.ts` — today/yesterday/older across midnight with a non-zero offset, `sessionsLabel(1)` and `(3)`, greeting edges 4, 5, 11, 12, 17, 18, `dateLine` for 2026-11-19.

Device check: fresh install shows the T1 layout with "My notes" in the pill; creating "Math" sets the pill to Math; the picker lists Math first with "Used today"; Spaces shows both; dark mode reads well; VoiceOver reads every button.

Not in this PR: the recording screen (M10b), pages (M10c), "Paste a link", renaming or deleting spaces, groups, the "From your groups" list, questions for later.

### M10b · Capture: the live recording screen

Branch `pr/m10b-record`. No new dependencies. Files: `src/core/capture/recording.ts`, `test/recording.test.ts`, `src/features/capture/RecordScreen.tsx`, `src/features/capture/useRecording.ts`, `src/platform/transcription.ts`, `src/app/record.tsx`, `src/app/(tabs)/_layout.tsx` (one hook call), `src/core/capture/sessions.ts` (additions only), `test/sessions.test.ts` (additions only).

Why it looks like this: C1, C3, C8, P1, P5 and P11, cut to stage 1 — record, see the words appear, pause, flag a moment, snap a photo of the board, stop. Everything the screen writes goes to SQLite as it happens, so a crash loses at most the audio part in progress (M5). Transcripts that could not be made live (no speech pack yet, or the app was locked and transcription stopped) are made from the audio files afterwards by a small queue.

`src/core/capture/recording.ts` (plain logic, all writes through the given `db`):

Below, `db` is `SqlDb` and `deps` is `{ now: () => number; newId: () => string }`.

```ts
export function startRecordingSession(db, deps, spaceId: string, speechReady: boolean): SessionRow   // kind 'recording', title "New recording", state 'recording', transcript 'live' | 'waiting'; touches the space
export function saveSegment(db, sessionId: string, piece: { tStart: number; tEnd: number; text: string }): void  // INSERT OR IGNORE, source 'device'
export function savePart(db, deps, sessionId: string, part: { index: number; startMs: number; durationMs: number; file: string }): void  // captures kind 'audio', position = index; ignore a second event for the same file
export function addFlag(db, deps, sessionId: string, t: number): void
export function addPhoto(db, deps, sessionId: string, t: number, file: string): string   // returns capture id
export function setPaused(db, sessionId: string, paused: boolean): void
export function finishRecording(db, sessionId: string, endedAt: number, recordedMs: number): void  // state 'saved', indexed_at NULL; transcript 'live' → 'done'
export function recoverSessions(db, nativeStatus: { sessionId: string; state: string }): string[]   // sessions in 'recording'/'paused' that native is not recording → 'interrupted', transcript → 'waiting' unless 'done'; returns ids
export function pendingTranscriptions(db): { sessionId: string; parts: { file: string; startMs: number; durationMs: number }[] }[]
```

`pendingTranscriptions` returns, for every session whose `transcript` is `'waiting'` and whose state is `'saved'` or `'interrupted'`, the audio parts that `partsNeedingTranscription` (M6) says have no segments.

`src/platform/transcription.ts`: `useTranscriptionQueue()`, called in `(tabs)/_layout.tsx`. When the app is active and `(await getSpeechStatus()).pack === "installed"`: run `recoverSessions` once per launch with `getRecorderStatus()`, then for each pending session, for each part, `transcribeFile(file, startMs)` and `saveSegment` each piece; when a session's parts are done set `transcript = 'done'` and `indexed_at = NULL`; on an error with code `speech_pack_missing` stop until next launch; other errors set that session's `transcript = 'failed'`. One at a time; never while the recorder state is `recording`.

`useRecording.ts` (the screen's hook) wires native events to the core functions: `onPart` → `savePart`; `onTranscript` → `addPiece` (UI state) and, when final, `saveSegment`; `onSpeechError` → remember that live transcription broke (the session's transcript becomes `'waiting'` at stop); `onState` → `setPaused` and UI state; `onLevel` → keep the last 48 levels.

`RecordScreen` flow:
1. On mount: `getMicPermission()`; if `undetermined`, `requestMicPermission()`. If `denied`, show P5: mic-off symbol in a `recSoft` circle, "Waypoint can't hear yet", "Turn on the microphone in Settings to record. You can still snap pages." — "Open Settings" (`Linking.openSettings()`) and "Snap pages instead" (→ replace with `/pages/new`). Leave the screen with the close button.
2. Otherwise read `getSpeechStatus()`; create the session with `startRecordingSession(db, deps, getSavingTo(db).id, pack === "installed")`; `startRecording(session.id)`. If the pack is `not_installed`, call `downloadSpeechPack()` and show the P11 banner: "Recording now. Words appear when the speech pack finishes downloading." with a progress bar and "{percent}% · your audio is safe either way". If `unsupported`: "This iPhone can't write down this language yet. Your audio is saved."
3. Top bar: the space name in a pill (read-only here) and the title "New recording".
4. The transcript: final lines (time `formatOffset(tStart)` in `ink3`, then the text), the volatile line in `ink3`. Flags and photos appear in time order between the lines: a marigold flag marker "Flagged" and a photo thumbnail. Auto-scroll to the end unless the person has scrolled up.
5. The dock (C1): red dot and `formatClock` (ticks every second from the last `recordedMs` plus time since that event while recording); a waveform of the last 48 levels (`rec` for the newest 8 bars, `ink4` for the rest); Pause/Resume; **Stop** (`rec` fill, `onRec` text). Under it: **Photo** (calls `scanPages(sessionId)`; each page → `addPhoto` with `t = Date.now() − startedAt`; then `readPage` in the background and store `found_text`/`found_lines`) and **Flag** (`flag` fill, `addFlag` at the same `t`; toast "Flagged at {formatOffset(t)}" above the dock for 2 s). Video, Note and Link are not shown.
6. Paused by the system (C8): a `flagSoft` banner "Recording paused at {formatClock(recordedMs)}" and the reason line — interruption: "Paused for a call or another app."; route change: "The microphone changed."; media reset: "Audio restarted." — then "Nothing before {formatClock} was lost." and two buttons, "Resume recording" (`rec`) and "Save & stop". A gap row "Gap · {formatClock(gapMs)} not captured" is shown in the transcript when a new part starts after a pause (from part start times).
7. Stop: `stopRecording()`, then `finishRecording(...)` with the returned ms; if live transcription broke or the session was `'waiting'`, set `transcript = 'waiting'` (the queue does the rest). Replace the route with `/session/<id>`.
8. The screen cannot be swiped away (M1a). While recording, the close button asks "Stop and save this recording?" with "Keep recording" and "Stop and save".

Tests (`test/recording.test.ts` and additions): every function above on the memory database — duplicate segment and duplicate part events are ignored; `finishRecording` sets `indexed_at` NULL and `transcript` correctly from `'live'` and `'waiting'`; `recoverSessions` only touches sessions native is not recording, and leaves `'done'` transcripts alone; `pendingTranscriptions` returns only uncovered parts of waiting sessions.

Device check (iPhone): record 2 minutes with the pack installed — words appear live, flags and a photo show in place, stop opens the session; turn on Airplane Mode and record again — works the same; record on a phone (or in a language) whose speech pack is not installed yet — the banner shows, and the transcript appears after the download; take a call mid-recording — the C8 banner, resume works, a gap row shows; force-quit during recording — on relaunch the session is "interrupted" and its finished parts get transcribed.

Not in this PR: the session screen (M10c), Live Activity and Dynamic Island, "recording elsewhere" on Home (B2), video, typed notes, links, questions for later answers, explanations, playing audio.

### M10c · Capture: snap pages, From Photos, Your pages, and the session screen

Branch `pr/m10c-pages-session`. Dependencies: `expo-image-picker` 58.0.10 (no config plugin — the system photo picker needs no permission). Files: `src/core/capture/pages.ts`, `test/pages.test.ts`, `src/platform/files.ts`, `src/platform/pageReading.ts`, `src/features/capture/NewPagesScreen.tsx`, `src/features/capture/YourPagesScreen.tsx`, `src/features/capture/PageSheet.tsx`, `src/features/capture/SessionScreen.tsx`, routes `src/app/pages/new.tsx`, `src/app/pages/[id].tsx`, `src/app/session/[id].tsx`, `src/app/_layout.tsx` (register them inside the signed-in guard), `src/app/(tabs)/_layout.tsx` (one hook call), `apps/mobile/package.json`.

Why it looks like this: section T — three taps plus one per page. The camera (VisionKit, M7) stays open for many pages; "From Photos" uses the system picker with multi-select where tap order is page order (T3); "Your pages" (T4) lets the student remove, add and reorder, then pick what to make. Pages are read on the iPhone in the background so the screen never waits for reading.

`src/core/capture/pages.ts`:

As in M10b, `db` is `SqlDb` and `deps` is `{ now, newId }`.

```ts
export function startPagesSession(db, deps, spaceId: string, title: string): SessionRow   // kind 'pages', state 'saved', transcript 'none'
export function addPages(db, deps, sessionId: string, files: string[]): string[]   // captures kind 'page', positions continue after the last; returns ids
export function listPages(db, sessionId: string): { id: string; file: string; position: number; foundText: string | null }[]
export function removePage(db, captureId: string): string   // returns the file path to delete; renumbers positions 0..n-1
export function movePage(db, captureId: string, toPosition: number): void   // renumbers 0..n-1
export function setPageText(db, captureId: string, text: string, linesJson: string): void   // also sets the session's indexed_at NULL
export function pagesToRead(db, limit: number): { id: string; file: string }[]   // kind 'page' or 'photo' with found_text IS NULL, oldest first
export function wordCount(texts: (string | null)[]): number
export function titleFromText(text: string | null, fallback: string): string   // first line with 3+ letters, trimmed to 60 at a word boundary
```

`src/platform/files.ts`: `fileUri(relative: string): string` (`new File(Paths.document, relative).uri`), `deleteFile(relative)` (ignores a missing file), `deleteSessionFiles(sessionId)` (removes `sessions/<id>/`), `sessionsBytes(): number` (`new Directory(Paths.document, "sessions")`, `exists ? info().size ?? 0 : 0` — this compiled here).

`src/platform/pageReading.ts`: `usePageReader()` in `(tabs)/_layout.tsx` — while active, every 5 s, `readPage` for up to 2 rows from `pagesToRead` and `setPageText(JSON.stringify(lines))`; a failed read stores empty text `""` so it is not retried forever; when a pages session's title is still "Pages" and page 1 now has text, set the title with `titleFromText`.

Screens:
- **New pages** (`/pages/new`, optional `?from=photos`, optional `?sessionId=` to add to an existing session): creates the session (if no `sessionId`) in `getSavingTo` with title "Pages"; camera path: `scanPages(sessionId)`; photos path: `launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, orderedSelection: true, selectionLimit: 30 })` then `importImage` for each asset in order. Then `addPages` and replace the route with `/pages/<sessionId>`. If nothing was added and the session is new, delete it and go back.
- **Your pages** (`/pages/[id]`, T4): back and "…" (menu: "Delete these pages" → confirm "Delete {n} pages? This can't be undone." → `deleteSessionRow` and `deleteSessionFiles`). Title "Your pages"; caption "{n} pages · {words} words read on this iPhone" (while any page is unread: "{n} pages · reading on this iPhone…"); "Saving to" pill opening `/space-picker?sessionId=<id>`; a 4-column grid of page thumbnails numbered 1..n with a remove (×) button, and an "Add" tile (camera → `/pages/new?sessionId=<id>`). Tapping a page opens `PageSheet`: the full page, "Move earlier", "Move later", "Remove page". Then "MAKE SOMETHING FROM THESE": rows "Help me with a problem" ("Tap any problem. Steps first, answer last.") → `/study/help?sessionId=`, "Flashcards" ("About {min(12, max(3, round(words / 40)))} cards · free") → `/study/make?sessionId=`, "Quiz me" ("5 questions · free") → `/study/quiz?sessionId=`; then a text button "Just save the pages" → `/session/<id>`; footer `OnDeviceNote` "Pages are read on this iPhone." The three study routes are built in M11a/M11b.
- **Session** (`/session/[id]`, E1/E2 simplified, optional `?t=`): back; the space name; the title (tap to rename, `renameSession`); date and `formatClock(recordedMs)` or "{n} pages". For recordings: the transcript list as in M10b (no volatile), with flags and photo thumbnails in time order and gap rows, scrolled to the segment nearest `t`; a caption while `transcript` is `'waiting'`: "Writing down the recording on this iPhone…", and for `'failed'`: "Couldn't write down this recording." For pages: each page image full width with its number, and "Show the text" toggles the read text under it. Bottom buttons: "Flashcards" → `/study/make?sessionId=`, "Quiz me" → `/study/quiz?sessionId=`, and for pages "Help me with a problem". "…" menu: "Move to another space" (`/space-picker?sessionId=`), "Delete" (confirm, then `deleteSessionRow` + `deleteSessionFiles`, back to Home).

Tests (`test/pages.test.ts`): positions after add, remove and move stay 0..n-1 in the right order; `removePage` returns the file; `setPageText` clears `indexed_at`; `pagesToRead` order and limit, and that `""` is not picked again; `wordCount`; `titleFromText` ("Practice 7.3 · Solve for x\n1. 3x…" → "Practice 7.3 · Solve for x"; a first line of "12" is skipped; 100 characters are cut at a word; null → fallback).

Device check (iPhone): Snap pages → 5 pages → Done lands on Your pages with 5 numbered thumbnails and the word count filling in; remove one and move one; Add appends; From Photos with three screenshots picked in a chosen order keeps that order; Just save the pages opens the session; the session title becomes the first line of page 1; deleting removes the files (Settings storage drops in M12).

Not in this PR: the study screens, T5, cropping or rotating pages, PDF import, "Paste a link", sharing, exporting.

### M11a · Study: flashcards and Review

Branch `pr/m11a-flashcards`. Dependencies: `ts-fsrs` 5.4.2. Files: `src/core/study/cards.ts`, `src/core/study/units.ts`, `src/core/study/labels.ts`, `test/cards.test.ts`, `test/units.test.ts`, `test/study-labels.test.ts`, `src/features/study/MakeCardsScreen.tsx`, `src/features/study/MadeScreen.tsx`, `src/features/study/ReviewScreen.tsx`, `src/features/study/ReviewHomeScreen.tsx`, `src/features/study/ModelUnavailable.tsx`, routes `src/app/study/make.tsx`, `src/app/study/review.tsx`, `src/app/(tabs)/review.tsx`, `src/app/_layout.tsx` (register `study/*` inside the signed-in guard), `src/features/capture/HomeScreen.tsx` (the "cards due" card only), `apps/mobile/package.json`.

Why it looks like this: T5, G1, G3, P7 and P10 for stage 1. Cards are made on the iPhone by M8's model, checked (M8 `cleanCards`), and saved with where they came from (page or moment). Scheduling uses FSRS through `ts-fsrs` 5.4.2 — its first-review intervals (1 min, 6 min, 10 min, then days) match G3's "Again <1m · Hard · Good · Easy". The `fsrs` column stores the ts-fsrs card as JSON with dates as Unix ms; `due_at` copies its due time so "due" is one indexed query.

`src/core/study/units.ts`: `studyUnits(db, sessionId): Unit[]` — for a pages session, one unit per page with text (in position order, `captureId` set, `t` null); for a recording, consecutive `device` segments grouped into units of about 1,200 characters (`t` = the first segment's `tStart`, `captureId` null), with photo text added as its own units.

`src/core/study/cards.ts`:

```ts
export type CardRow = { id: string; sessionId: string; kind: "term" | "problem" | "question"; front: string; back: string; captureId: string | null; t: number | null; dueAt: number };
export type NewCard = { kind: "term" | "problem" | "question"; front: string; back: string; captureId: string | null; t: number | null };
export function saveCards(db: SqlDb, deps: { now: () => number; newId: () => string }, sessionId: string, cards: NewCard[], madeBy: "device_model" | "quiz_miss"): CardRow[]   // new FSRS card, due now
export function dueCards(db, now: number, options: { sessionId?: string; limit: number }): CardRow[]   // due_at <= now, oldest due first
export function countDue(db, now: number): number
export function previewIntervals(db, cardId: string, now: number): Record<1 | 2 | 3 | 4, number>   // ms until due for Again, Hard, Good, Easy
export function reviewCard(db, cardId: string, rating: 1 | 2 | 3 | 4, now: number): CardRow   // ts-fsrs next(); writes the reviews row and new fsrs/due_at
export function nextDueAt(db, now: number): number | null
export function sessionCardCount(db, sessionId: string): number
```

Use `fsrs(generatorParameters({ enable_fuzz: false }))` once at module level, `createEmptyCard(new Date(now))`, `f.repeat(card, new Date(now))` for previews and `f.next(card, new Date(now), rating)` for reviews (ratings 1–4 are `Rating.Again..Easy`). Parse stored JSON back into a ts-fsrs card (dates from ms) with a small zod schema; a bad row throws.

`src/core/study/labels.ts`: `intervalLabel(ms)` → "<1m", "6m", "10m", "1h", "2d", "5d", "3mo" (minutes under an hour, hours under a day, days under 60 days, else months, rounded); `minutesLabel(cards)` → "About {ceil(cards × 30 s / 60)} min"; `madeSummary(cards)` → `{ terms, problems }`; `availabilityMessage(a: ModelAvailability)` → the copy below.

Screens:
- **Make** (`/study/make?sessionId=`): if `getAvailability()` is not `"available"`, show `ModelUnavailable`. Otherwise "Making flashcards on this iPhone…" with a spinner, run `makeCardsFromUnits(port, studyUnits(...), 12)` (the port wraps `waypoint-model`), `saveCards`, and replace with `/study/review?sessionId=&made=1`. On an error: "Couldn't make flashcards this time." with "Try again". Zero cards: "There wasn't enough here to make flashcards."
- **Made** (T5; shown by the review route when `made=1`, before the first card): the stack symbol in an accent ring; "{n} flashcards from your {m} pages." or "{n} flashcards from your recording."; "Made on this iPhone. Saved in {space}."; a "WHAT'S IN THEM" box: "{terms} terms and what they mean", "{problems} worked problems, step by step", and "Each card shows the page it came from" (pages) or "Each card shows the moment it came from" (recording) — leave out lines whose count is 0; "Start practising"; "See the pages" / "See the recording" → `/session/<id>`.
- **Review** (`/study/review`, optional `sessionId`; G3): close button; "Flashcards"; "{space} · {i} of {n}" and a progress bar; the card — a caps label ("DEFINITION" for term, "PROBLEM", "QUESTION"), the front large and centred, tap to flip to the back (a simple cross-fade is fine; honour Reduce Motion); a source chip under it, "From page {position + 1}" or "From {title} · {formatOffset(t)}", which opens the session at that page or time; four buttons Again (`danger` tint), Hard, Good (`accent` tint), Easy (`local` tint), each with `intervalLabel(previewIntervals[r])` under it. After the last due card (P10): "Review complete" and "Next cards are due {in 10 minutes | tomorrow | on Nov 23}" from `nextDueAt`, and "Done".
- **Review tab** (G1 cut down; P7 when there are no cards at all): title "Review"; when cards are due, a card with a ring showing due/total, "{n} cards due", `minutesLabel`, and "Start review"; when none are due but cards exist, "All caught up" and the next due time; then "MAKE A REVIEW" listing the 5 newest sessions with "Flashcards" and "Quiz me" buttons each. P7 empty: stack symbol, "Nothing to review yet", "Make flashcards from a recording or your pages and they show up here.", button "Snap pages" → `/pages/new`.
- **Home** (B1): when `countDue > 0`, a card "{n} cards due", `minutesLabel`, "Start" → `/study/review`.

`ModelUnavailable` copy by availability: `device_not_eligible` — "Flashcards, quizzes and help are made by Apple Intelligence, which this iPhone doesn't have. Recording, pages and search still work."; `apple_intelligence_off` — "Turn on Apple Intelligence in Settings to make flashcards on this iPhone." with "Open Settings"; `model_not_ready` — "Apple Intelligence is still getting ready on this iPhone. Try again in a little while."; `unavailable` — "Flashcards can't be made on this iPhone right now."

Tests: `cards.test.ts` (memory database, fixed clock): new cards are due now; Good on a new card is due in 10 min and Again in 1 min (`enable_fuzz: false`); a review writes a `reviews` row with `due_before`/`due_after`; `previewIntervals` matches what `reviewCard` then does; `dueCards` order, limit and session filter; `countDue`; `nextDueAt`; JSON round trip keeps dates; a corrupt `fsrs` value throws. `units.test.ts`: pages in order with capture ids; transcript grouping and `t`; photo text units; empty session → `[]`. `study-labels.test.ts`: every boundary of `intervalLabel`, `minutesLabel(14)` = "About 7 min", `madeSummary`, all four availability messages.

Device check (Apple Intelligence iPhone): from 5 snapped pages, make cards → T5 counts match → review 3 cards with different ratings → the due count on Review and Home drops and comes back after 1 min for Again; on a non-eligible phone or with Apple Intelligence off the right message shows and nothing crashes.

Not in this PR: quiz and help (M11b), editing or deleting cards, "Show source · play 10 s", memory schedule (G11), struggling-with lists, audio/video/diagram/mini-app formats, notifications.

### M11b · Study: quiz and help with a problem

Branch `pr/m11b-quiz-help`. No new dependencies. Files: `src/core/study/quiz.ts`, `src/core/study/help.ts`, `test/quiz.test.ts`, `test/help.test.ts`, `src/features/study/QuizScreen.tsx`, `src/features/study/HelpPickScreen.tsx`, `src/features/study/HelpStepsScreen.tsx`, routes `src/app/study/quiz.tsx`, `src/app/study/help.tsx`, `src/app/study/help-steps.tsx`, `src/app/_layout.tsx` (register them).

Why it looks like this: G4 and T4. Questions are made on the iPhone and are not stored; a wrong answer becomes a flashcard ("Wrong answers become flashcards"). "Help me with a problem" follows T4's line "Steps first, answer last": the student taps a problem on their page, sees one step at a time, and the answer only when they ask for it. (Whether this is right for everyone is an open decision in the journey review; this card follows T4.)

`src/core/study/quiz.ts`:

```ts
export type QuizState = { questions: QuizDraft[]; index: number; picked: number | null; right: number; missed: QuizDraft[] };
export function startQuiz(questions: QuizDraft[]): QuizState
export function pick(state: QuizState, choice: number): QuizState   // ignored if already picked or out of range
export function next(state: QuizState): QuizState                   // only after a pick
export function isDone(state: QuizState): boolean
export function missedToCards(missed: QuizDraft[]): NewCard[]   // kind "question", front = question, back = "{right choice}. {why}", captureId and t null
export function quizCount(kind: "recording" | "pages"): number      // 8 for recordings, 5 for pages
```

`NewCard` and `saveCards` come from M11a (`src/core/study/cards.ts`); nothing outside this card's files changes.

`src/core/study/help.ts`: `problemContext(pageText: string, block: Block, maxChars = 3000): string` — the page text with the problem kept and the rest cut from both ends to fit; `type HelpState = { steps: …; shown: number; answerShown: boolean }`, `startHelp(draft)`, `showNextStep(state)`, `showAnswer(state)` (only allowed when every step is shown).

Screens:
- **Quiz** (`/study/quiz?sessionId=`, G4): availability check as in M11a; "Making a quiz on this iPhone…"; `makeQuizFromUnits(port, studyUnits, quizCount(kind))`. Then: close; "Quiz"; "Question {i} of {n}" and a progress bar; the question in a card; four choices labelled A–D. After a pick: the right choice turns `local` with a check; a wrong pick turns `danger`; a box below — right: "Right — {why}"; wrong: "Not quite. The answer is {letter}: {choice}." and `{why}` — and "Next" (or "See how you did" on the last). Footer caption "Wrong answers become flashcards". End: "{right} of {n} right."; if any were missed, save them with `saveCards(..., missedToCards(missed), "quiz_miss")` and say "{k} flashcards added from the ones you missed."; buttons "Review them" (→ `/study/review?sessionId=`) and "Done".
- **Help, pick a problem** (`/study/help?sessionId=`): availability check; "Tap a problem"; each page image full width with its blocks (`groupBlocks(parseLines(found_lines))`) drawn as tappable rounded outlines (`accent`, 2 px) over the image (scale block boxes by the image's displayed size); pages still being read show "Reading this page…". Tapping a block → `/study/help-steps?sessionId=&captureId=&block=<i>`.
- **Help, steps** (`/study/help-steps`): the problem text at the top in a card; "Working it out on this iPhone…" then `helpWithProblem(block.text, problemContext(...))` → `cleanHelp`. Show "Step 1 of {n}" with the title and detail; "Next step" reveals the next one under it; after the last step, "Show the answer" reveals the answer in a `local`-tinted box. A caption under the steps: "Try each step yourself before you look at the next one." If `cleanHelp` is null or the call fails: "Couldn't work this one out on this iPhone." with "Try again". `declined` error: "This problem can't be answered here."

Tests: `quiz.test.ts` — pick/next/done rules, double pick ignored, out-of-range ignored, counts of right and missed, `missedToCards` text, `quizCount`; `help.test.ts` — `problemContext` keeps the problem and fits the limit, short pages unchanged; you cannot show the answer before all steps; `showNextStep` stops at the last.

Device check (Apple Intelligence iPhone): quiz from a recording gives 8 questions with 4 choices each; two wrong answers add two "QUESTION" flashcards that appear in Review; on the T2-style worksheet each numbered problem is its own tappable outline; problem 4 (the train) shows steps without the arrival time until "Show the answer".

Not in this PR: saving quiz results, "Why not A?" per-choice explanations, handwriting input, checking the student's own working, any cloud help.

### M12 · Settings

Branch `pr/m12-settings`. No new dependencies. Files: `src/features/settings/SettingsScreen.tsx`, `src/features/settings/PermissionsScreen.tsx`, `src/features/settings/StorageScreen.tsx`, `src/core/settings/format.ts`, `test/settings-format.test.ts`, routes `src/app/settings.tsx`, `src/app/settings-permissions.tsx`, `src/app/settings-storage.tsx`, `src/app/_layout.tsx` (register them).

Why it looks like this: K1, K5 and A7 cut to what exists on one phone in stage 1. Devices, recovery key, groups, plans, AI modes, cloud activity and reading level belong to later stages and are not shown (not even greyed out).

`src/core/settings/format.ts`: `bytesLabel(n)` → "0 KB", "340 MB", "1.2 GB" (1,000-based, one decimal from GB); `percentLabel(done, total)` → "98%" (total 0 → "100%").

Screens:
- **Settings** (K1): back; "Settings". Account card: avatar initial, first name, email, and "Signed in with Apple" with the Apple symbol when `viaApple`. Section "ON THIS IPHONE": "Speech pack" — value from `getSpeechStatus()`: "Ready · {locale}" / "Not downloaded" (tap → `downloadSpeechPack()` with progress) / "Downloading {pct}%" / "Not available for this language"; "Apple Intelligence" — "Ready" or the short reason ("Not on this iPhone", "Turned off", "Getting ready"); "Permissions" → Permissions; "Storage & search" → Storage. Section "ABOUT": "Version {expoConfig.version} ({nativeBuildVersion})" from `expo-constants`. At the bottom: "Sign out" in `danger` with the line "Signing out doesn't delete your notes." — confirm "Sign out of Waypoint?" then `useSignOut()`.
- **Permissions** (A7 as a settings page, not first run): rows Microphone ("Record classes and talks"), Speech recognition ("Write down recordings on this iPhone"), Camera ("Snap pages") with "Allowed" (`localSoft` chip) or "Not allowed"/"Allow"; "Allow" asks the system when the status is `undetermined` (`requestMicPermission`; speech and camera are asked by the system on first use, so their row shows "Asked when you first use it" until then), otherwise opens `Linking.openSettings()`. Footer: "Change any of these in Settings." Notifications and Background activity rows from A7 are left out (no notifications in stage 1; background audio needs no permission).
- **Storage & search** (K5 cut down): a bar and labels for "Recordings and pages {bytesLabel(sessionsBytes())}"; the search card: "Searchable" with `percentLabel(indexed, sessions)` and "{chunks} pieces of text · model {modelVersion}" from `indexStatus`; "Rebuild search" → confirm, then set every session's `indexed_at = NULL` (the M9b indexer does the rest); the `OnDeviceNote` "Your search index never leaves this iPhone."

Tests: `settings-format.test.ts` — byte and percent boundaries.

Device check: every row shows a real value; downloading the speech pack from here works; sign out returns to Welcome and signing back in shows the same notes; Rebuild search drops the percentage and it climbs back.

Not in this PR: plans and purchases, devices, recovery key, groups, AI modes and per-space overrides, cloud activity, notifications, appearance override, export, deleting all data.

---

## 3. Stages 2 to 4: outline

One line each. Full cards are written when the stage starts, against the code that exists by then.

**Stage 2: talks to the API**

| Card | Title |
|---|---|
| M3 | `packages/api-client`: typed client on `fetch` using `packages/contracts` schemas — Clerk token per request, `Idempotency-Key` on every write, device signature headers (`docs/security.md` section 7) on the writes that need them through an injected signer, a new nonce and timestamp on every retry, the one error shape, 402 shortfall, streaming for explain; tested in Node with a fake `fetch` and a software signer, against the `waypoint-v1.json` request vectors from S0B |
| M26 | Native `modules/waypoint-keys`: device signing and encryption keys in the Secure Enclave / Keychain, request signing, sealing and opening, per `docs/security.md` section 19 (needs iOS 17; the app's minimum is 26). Built now: the owner decided on 19 Nov 2026 to build the security cards, with an outside review before real students use the app |
| M27a | Register this iPhone after sign-in: the first device makes the account key and calls `POST /v1/devices` with `account` (S1B); the API client signs with M26's keys. Comes before M14, M16, M18 and M19, which all spend or buy credits. The recovery key prompt comes with M27b; until stage 4 nothing on the server is locked with the account key, so nothing is lost without it |
| M13 | `GET /v1/config` on launch and the minimum-native-version check ("Update Waypoint" screen) |
| M14 | Native `modules/waypoint-store`: StoreKit 2 products, purchase with `appAccountToken` set to the signed-in user's id, `Transaction.updates`, restore, Family Sharing flag; sends the signed transaction to `POST /v1/purchases/apple` (signed request) |
| M15 | Plans bundle (`src/features/plans`): O1–O14 — choose a plan, Own it, Plus, buy credits, before you run it (quote), out of credits and retry, restore |
| M16 | Explain bundle (`src/features/explain`): D1–D8 — tap a word, quote, stream the answer, peek/half/full thread, saved vs ephemeral, "What was sent" (`sent_log`), offline → questions for later; adds the `explanations`, `terms` and `sent_log` tables |
| M17 | Questions for later: flags get answers (D9, R5), the Home row (B1) |
| M18 | Second transcript (flow 3): opt-in sheet that says audio leaves the phone, signed upload, job polling, changed-words view |
| M19 | Research the web screens (D10–D12) on the jobs API |
| M20 | Push notifications (`expo-notifications`): token to `POST /v1/push-tokens` with `device_id` = this device's `devices.id` (after M27a), lowercase hex, `sandbox` in development builds; "your overview is ready" |
| M21 | Cloud activity and zero-retention settings (J5, K2's Plus switch). Until the server has a zero-retention route, turning the switch on makes every cloud task fail with 403; the sheet must say so (or hide the switch, see the open questions in `docs/build-plan.md`) |

**Stage 3: overviews and voices**

| Card | Title |
|---|---|
| M22 | Native `modules/waypoint-voices`: Kokoro-82M Core ML voice pack fetched from R2 on first use and checked by SHA-256; `AVSpeechSynthesizer` system voices until it is ready; MeloTTS cloud fallback on older phones (+2 credits) |
| M23 | Audio overview bundle (G7, R1–R3): job, script fetch, two-voice render saved locally, `DELETE` the result; adds the `overviews` table |
| M24 | Video overview (G10): slides from the job, narration and assembly on the iPhone (`AVAssetWriter`) |
| M25 | Diagram, mini app and practice set screens (G8, G9) |

**Stage 4: keys, sync, sharing, system surfaces**

| Card | Title |
|---|---|
| M27b | Devices: add and approve another device with the 6-digit code, remove a device, recovery key (A4–A6, J1–J3), on top of S1C, S1D and S3 |
| M28 | Sync engine: `outbox` table, locked changes to the group room socket, catch-up by sequence, media upload on paid plans |
| M29 | Share bundle (`src/features/share`): groups, invites, shared links, move a note, access ending, key history (I1–I9, E9) |
| M2 | Zephyr: `zephyr-metro-plugin`, `@module-federation/metro`, one remote per `src/features/*` folder plus `src/shell`, tag per native version, `zephyr-native-cache`, apply on next cold start, never during a recording. Starts with a spike: `@module-federation/metro` 2.9.3 declares Metro `^0.82` while SDK 58 ships 0.87, and expo-router with remotes is not documented |
| M30 | System targets: Home Screen widgets (B5), Live Activity and Dynamic Island for recording (C10), share extension (E8), shared state through an App Group — via `expo-widgets` 58 or a config plugin that adds the Swift targets |
| M31 | sqlite-vec on iOS once expo/expo#43455 ships the xcframework (or a patch), replacing the TypeScript vector scan; same `search_index` data |
| M32 | Component tests with `jest-expo` if screens grow logic that `src/core` cannot hold |
| V1 | `apps/viewer`: the shared-link web viewer (already in the build plan) |

---

## 4. Open questions for the owner

1. **Upgrade macOS tonight?** Required for SDK 58 (Xcode ≥ 26.4 needs macOS Tahoe 26.2+; Xcode 27.2 needs 26.6). The alternative is building in the cloud (EAS Build), which this plan does not use.
2. **Sign-in before the free features?** The cards follow the docs (sign-in first, A1). Recommendation: let on-device features work without an account and ask for sign-in only for credits, sync and sharing — fewer barriers for students, and no account for under-13s unless needed. One constant (`REQUIRE_SIGN_IN`) flips it.
3. **Bundle id and Apple Team ID.** `app.json` uses `app.waypoint.ios` as a placeholder; it must match the App Store Connect app and the Clerk native-app settings. The Team ID goes into Clerk and, if wanted, `ios.appleTeamId` in `app.json`.
4. **Clerk instance.** Publishable key for development; turn on email code and Apple; register the iOS app for native Sign in with Apple. Terms and Privacy URLs for the Welcome footer.
5. **Phones without Apple Intelligence.** Stage 1 shows why flashcards, quiz and help are unavailable. Should stage 2 offer them in the cloud for credits on those phones?
6. **Page camera look.** VisionKit's document camera cannot be restyled, so T2 ("Page 4 · edges found", our Done button) is approximated by Apple's own UI. Accept for stage 1, or plan a custom AVFoundation camera with Vision rectangle detection later?
7. **Transcript language.** Stage 1 uses the first of the phone's preferred languages that the speech engine supports. Is a per-space or per-recording language choice needed (for language classes)?
8. **"Help me with a problem": steps first, answer last for everyone?** Cards follow T4. (Also open in the journey review.)
9. **Background transcription on iOS 27.** If M6's device check shows live transcription stopping while the screen is locked, M10b writes those stretches down from the audio files after the recording ends. Is that delay acceptable?
10. **Encryption at rest on the device** (SQLCipher via `expo-sqlite`'s `useSQLCipher`, or iOS data protection only) — for `docs/security.md` to decide.
