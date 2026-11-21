import { useEffect } from "react";
import { AppState } from "react-native";
import { readPage } from "../../modules/waypoint-pages/index.ts";
import { nameUntitledPages, pagesToRead, setPageText } from "../core/capture/pages.ts";
import { dbGeneration, getDb, useQuery, writeDb, writeDbIf } from "./db.ts";

const INTERVAL_MS = 5000;
// While any page or photo is still unread, the reader runs this often, so a session waiting on it starts soon.
const UNREAD_INTERVAL_MS = 1000;
const BATCH = 2;
// After a pass that threw (the notes closed, a write failed), no pass starts for this long: no hot loop.
const COOLDOWN_MS = 30_000;

// One pass at a time, for the whole app: an effect that re-runs must not start a second pass beside a running one.
let busy = false;
let cooldownUntil = 0;

// Reads pages on the iPhone in the background, while the app is active. Mounted once, in the tabs layout.
// A pass runs at once when something new is unread, then every second until nothing is.
export function usePageReader(): void {
  const unread = useQuery((db) => pagesToRead(db, 1).length > 0);

  useEffect(() => {
    const tick = async () => {
      if (busy || Date.now() < cooldownUntil || AppState.currentState !== "active") return;
      busy = true;
      try {
        const generation = dbGeneration();
        for (const row of pagesToRead(getDb(), BATCH)) {
          // Sent to the background in the middle of a pass: stop before the next page.
          if (AppState.currentState !== "active") break;
          let text = "";
          let lines = "[]";
          try {
            const page = await readPage(row.file);
            text = page.text;
            lines = JSON.stringify(page.lines);
          } catch {
            // A failed read stores empty text, so the page is not tried again.
          }
          try {
            writeDbIf(generation, (db) => {
              setPageText(db, row.id, text, lines);
              nameUntitledPages(db);
            });
          } catch {
            // The page was removed while it was being read, or the write failed: wait before trying again.
            cooldownUntil = Date.now() + COOLDOWN_MS;
            break;
          }
        }
      } catch {
        // Signed out, or the notes could not be read: try again after a pause.
        cooldownUntil = Date.now() + COOLDOWN_MS;
      } finally {
        busy = false;
      }
    };

    if (unread) void tick();
    const timer = setInterval(
      () => {
        void tick();
      },
      unread ? UNREAD_INTERVAL_MS : INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [unread]);
}

// Reads one page again, from the person's "Try again". Nothing is written when the read finds no words, so the page
// keeps its text as it was. Returns whether words were found. A failed read returns false.
export async function retryPageRead(captureId: string, file: string): Promise<boolean> {
  const generation = dbGeneration();
  try {
    const page = await readPage(file);
    if (page.text.trim() === "") return false;
    writeDbIf(generation, (db) => {
      // Text typed or synced while this read ran is kept; a removed page is left alone.
      const row = db.get<{ found_text: string | null }>("SELECT found_text FROM captures WHERE id = ?", [captureId]);
      if (row === null || (row.found_text ?? "").trim() !== "") return;
      setPageText(db, captureId, page.text, JSON.stringify(page.lines));
      nameUntitledPages(db);
    });
    return true;
  } catch {
    return false;
  }
}
