import { useEffect, useRef } from "react";
import { Alert, View } from "react-native";
import { randomUUID } from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { importImage, isScannerSupported, scanPages } from "../../../modules/waypoint-pages/index.ts";
import { addPages, startPagesSession } from "../../core/capture/pages.ts";
import { deleteSessionRow } from "../../core/capture/sessions.ts";
import { getSavingTo } from "../../core/db/spaces.ts";
import { writeDb } from "../../platform/db.ts";
import { deleteSessionFiles } from "../../platform/files.ts";
import { useColors } from "../../ui/theme.ts";

const deps = { now: Date.now, newId: randomUUID };

// Opens the document camera (or the photo picker with ?from=photos) as soon as it appears.
// The pages go into a new session, or into ?sessionId=, and the screen becomes "Your pages".
export default function NewPagesScreen() {
  const colors = useColors();
  const { from, sessionId } = useLocalSearchParams<{ from?: string; sessionId?: string }>();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void capture(from === "photos", sessionId);
  }, []);

  return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
}

async function capture(fromPhotos: boolean, existingId: string | undefined): Promise<void> {
  const created = existingId === undefined;
  const sessionId = existingId ?? writeDb((db) => startPagesSession(db, deps, getSavingTo(db).id, "Pages").id);
  try {
    const files = fromPhotos ? await pickFromPhotos(sessionId) : await scanWithCamera(sessionId);
    if (files.length === 0) {
      if (created) discardSession(sessionId);
      router.back();
      return;
    }
    writeDb((db) => addPages(db, deps, sessionId, files));
    router.replace(`/pages/${sessionId}`);
  } catch (error) {
    if (created) discardSession(sessionId);
    Alert.alert("Couldn't add the pages.", messageOf(error), [{ text: "OK", onPress: () => router.back() }]);
  }
}

async function scanWithCamera(sessionId: string): Promise<string[]> {
  if (!isScannerSupported()) throw new Error("The document camera is not supported on this device");
  return (await scanPages(sessionId)).map((page) => page.file);
}

// Multi-select keeps the order the photos were tapped in, which becomes the page order.
async function pickFromPhotos(sessionId: string): Promise<string[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    orderedSelection: true,
    selectionLimit: 30,
  });
  if (result.canceled) return [];
  const files: string[] = [];
  for (const asset of result.assets) {
    files.push((await importImage(sessionId, asset.uri)).file);
  }
  return files;
}

function discardSession(sessionId: string): void {
  writeDb((db) => deleteSessionRow(db, sessionId));
  deleteSessionFiles(sessionId);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
