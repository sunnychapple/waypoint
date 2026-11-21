import { useEffect, useRef, useState } from "react";
import { Alert, AppState, Linking, StyleSheet, View } from "react-native";
import { randomUUID } from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { importImage, isScannerSupported, scanPages } from "../../../modules/waypoint-pages/index.ts";
import { addPages, startPagesSession } from "../../core/capture/pages.ts";
import { deleteSessionRow } from "../../core/capture/sessions.ts";
import { getSavingTo } from "../../core/db/spaces.ts";
import { writeDb } from "../../platform/db.ts";
import { deleteSessionFiles } from "../../platform/files.ts";
import { BackButton, Body, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

const deps = { now: Date.now, newId: randomUUID };

// Opens the document camera (or the photo picker with ?from=photos) as soon as it appears.
// The pages go into a new session, or into ?sessionId=, and the screen becomes "Your pages".
// With no camera access it says so and offers the photo picker; coming back from Settings with access carries on.
export default function NewPagesScreen() {
  const colors = useColors();
  const { from, sessionId } = useLocalSearchParams<{ from?: string; sessionId?: string }>();
  const started = useRef(false);
  const cameraBlocked = useRef(false);
  const [blocked, setBlocked] = useState(false);

  function setCameraBlocked(value: boolean) {
    cameraBlocked.current = value;
    setBlocked(value);
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (from === "photos") {
      void capture(true, sessionId);
      return;
    }
    void cameraAllowed().then((allowed) => {
      if (allowed) void capture(false, sessionId);
      else setCameraBlocked(true);
    }).catch(() => setCameraBlocked(true));
  }, []);

  useEffect(() => {
    let mounted = true;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !cameraBlocked.current) return;
      void cameraGranted().then((granted) => {
        // Gone already (the student pressed Back while the check ran): do not open the scanner behind them.
        if (!mounted || !granted || !cameraBlocked.current) return;
        setCameraBlocked(false);
        void capture(false, sessionId);
      });
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [sessionId]);

  function fromPhotosInstead() {
    setCameraBlocked(false);
    void capture(true, sessionId);
  }

  if (!blocked) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <Screen>
      <View style={styles.topRow}>
        <BackButton />
      </View>
      <Title>NotePath can't use the camera</Title>
      <Body>Turn on Camera for NotePath in Settings, or pick pages from your photos.</Body>
      <View style={styles.actions}>
        <PrimaryButton label="Open Settings" onPress={() => void Linking.openSettings()} />
        <SecondaryButton label="From Photos instead" onPress={fromPhotosInstead} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: "row", justifyContent: "space-between" },
  actions: { gap: 12, marginTop: 24 },
});

// Asks for the camera only when the student has not been asked yet; a denied camera stays denied until Settings changes it.
export async function cameraAllowed(): Promise<boolean> {
  let status = await ImagePicker.getCameraPermissionsAsync();
  if (status.status === ImagePicker.PermissionStatus.UNDETERMINED) status = await ImagePicker.requestCameraPermissionsAsync();
  return status.granted;
}

async function cameraGranted(): Promise<boolean> {
  return (await ImagePicker.getCameraPermissionsAsync()).granted;
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
    // Added to an existing session: go back to its Your pages screen, which re-reads the new pages.
    if (created) router.replace(`/pages/${sessionId}`);
    else router.back();
  } catch (error) {
    if (created) discardSession(sessionId);
    // Plain words only; the native error text is not for students.
    const message = error instanceof ScannerUnsupported ? "This iPhone can't scan pages. Try From Photos instead." : "Please try again.";
    Alert.alert("Couldn't add the pages.", message, [{ text: "OK", onPress: () => router.back() }]);
  }
}

class ScannerUnsupported extends Error {}

async function scanWithCamera(sessionId: string): Promise<string[]> {
  if (!isScannerSupported()) throw new ScannerUnsupported();
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
