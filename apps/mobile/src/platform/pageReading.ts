import { useEffect } from "react";
import { AppState } from "react-native";
import { readPage } from "../../modules/waypoint-pages/index.ts";
import { pagesToRead, setPageText, titleFromText } from "../core/capture/pages.ts";
import { renameSession } from "../core/capture/sessions.ts";
import type { SqlDb } from "../core/db/sql.ts";
import { dbGeneration, getDb, writeDbIf } from "./db.ts";

const INTERVAL_MS = 5000;
const BATCH = 2;

// Reads pages on the iPhone in the background, while the app is active. Mounted once, in the tabs layout.
export function usePageReader(): void {
  useEffect(() => {
    let busy = false;

    const tick = async () => {
      if (busy || AppState.currentState !== "active") return;
      busy = true;
      try {
        const generation = dbGeneration();
        for (const row of pagesToRead(getDb(), BATCH)) {
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
            // The page was removed while it was being read.
          }
        }
      } finally {
        busy = false;
      }
    };

    const timer = setInterval(() => {
      void tick();
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
}

// A pages session still called "Pages" takes its title from the first line of page 1 once that is read.
function nameUntitledPages(db: SqlDb): void {
  const rows = db.all<{ id: string; found_text: string | null }>(
    `SELECT s.id, c.found_text FROM sessions s
     JOIN captures c ON c.session_id = s.id AND c.kind = 'page' AND c.position = 0
     WHERE s.kind = 'pages' AND s.title = 'Pages' AND c.found_text IS NOT NULL`,
  );
  for (const row of rows) {
    renameSession(db, row.id, titleFromText(row.found_text, "Pages"));
  }
}
