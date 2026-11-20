import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import {
  downloadSpeechPack,
  getMicPermission,
  getSpeechStatus,
  onRecorderLevel,
  onRecorderPart,
  onRecorderState,
  onSpeechError,
  onSpeechPackProgress,
  onTranscript,
  pauseRecording,
  requestMicPermission,
  resumeRecording,
  startRecording,
  stopRecording,
  type PartEvent,
  type PauseReason,
  type RecorderState,
  type SpeechStatus,
} from "../../../modules/waypoint-audio/index.ts";
import { isScannerSupported, scanPages } from "../../../modules/waypoint-pages/index.ts";
import { addPiece, EMPTY_LIVE, type LiveTranscript, type Piece } from "../../core/capture/transcript.ts";
import { addFlag, addPhoto, finishRecording, savePart, saveSegment, setPaused, startRecordingSession } from "../../core/capture/recording.ts";
import { deleteSessionRow, type SessionRow } from "../../core/capture/sessions.ts";
import { buildTimeline, type TimelineItem } from "../../core/capture/timeline.ts";
import { getSavingTo } from "../../core/db/spaces.ts";
import { writeDb } from "../../platform/db.ts";
import { deleteSessionFiles } from "../../platform/files.ts";

const deps = { now: Date.now, newId: randomUUID };
const LEVELS_KEPT = 48;
const TOAST_MS = 2000;

export type { TimelineItem };

export type Banner = { kind: "downloading"; percent: number } | { kind: "unsupported" } | null;

export type RecordingModel = {
  phase: "checking" | "denied" | "recording";
  sessionId: string | null;
  spaceName: string;
  recorder: RecorderState;
  pauseReason: PauseReason;
  clockMs: number;
  levels: number[];
  timeline: TimelineItem[];
  volatile: Piece | null;
  banner: Banner;
  toast: { t: number } | null;
  stopping: boolean;
  pause: () => void;
  resume: () => void;
  flag: () => void;
  photo: () => void;
  stop: () => void;
};

type Photo = { id: string; t: number; file: string };

// The live recording screen. Native events go to SQLite as they happen, and the screen state is kept here.
export function useRecording(): RecordingModel {
  const [phase, setPhase] = useState<RecordingModel["phase"]>("checking");
  const [spaceName, setSpaceName] = useState("");
  const [recorder, setRecorder] = useState<RecorderState>("idle");
  const [pauseReason, setPauseReason] = useState<PauseReason>("none");
  const [anchor, setAnchor] = useState({ ms: 0, at: 0 });
  const [now, setNow] = useState(() => Date.now());
  const [levels, setLevels] = useState<number[]>([]);
  const [live, setLive] = useState<LiveTranscript>(EMPTY_LIVE);
  const [parts, setParts] = useState<PartEvent[]>([]);
  const [resumes, setResumes] = useState<number[]>([]);
  const [flags, setFlags] = useState<number[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [pack, setPack] = useState<SpeechStatus["pack"] | null>(null);
  const [fraction, setFraction] = useState(0);
  const [toast, setToast] = useState<{ t: number } | null>(null);
  const [stopping, setStopping] = useState(false);

  const sessionRef = useRef<SessionRow | null>(null);
  const brokeRef = useRef(false);
  const stoppingRef = useRef(false);

  // Native events for this session only.
  useEffect(() => {
    const mine = (sessionId: string): boolean => sessionRef.current?.id === sessionId;
    const subscriptions = [
      onRecorderState((e) => {
        if (!mine(e.sessionId)) return;
        // A resume: the gap row can be drawn now (session time, the same clock flags use).
        const started = sessionRef.current?.startedAt;
        if (e.state === "recording" && started !== undefined) setResumes((previous) => [...previous, Date.now() - started]);
        setRecorder(e.state);
        setPauseReason(e.reason);
        setAnchor({ ms: e.recordedMs, at: Date.now() });
        if (e.state !== "idle") writeDb((db) => setPaused(db, e.sessionId, e.state === "paused"));
      }),
      onRecorderPart((e) => {
        if (!mine(e.sessionId)) return;
        writeDb((db) => savePart(db, deps, e.sessionId, e));
        setParts((previous) => [...previous, e]);
      }),
      onRecorderLevel((e) => setLevels((previous) => [...previous.slice(-(LEVELS_KEPT - 1)), e.level])),
      onTranscript((e) => {
        if (!mine(e.sessionId)) return;
        setLive((previous) => addPiece(previous, e));
        if (e.isFinal) writeDb((db) => saveSegment(db, e.sessionId, e));
      }),
      onSpeechError((e) => {
        if (mine(e.sessionId)) brokeRef.current = true;
      }),
      onSpeechPackProgress((e) => setFraction(e.fraction)),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, []);

  // Permission, then the session, then the recorder.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        let permission = await getMicPermission();
        if (permission === "undetermined") permission = await requestMicPermission();
        if (cancelled) return;
        if (permission !== "granted") {
          setPhase("denied");
          return;
        }
        const speech = await getSpeechStatus();
        if (cancelled) return;
        const created = writeDb((db) => {
          const space = getSavingTo(db);
          return { space, session: startRecordingSession(db, deps, space.id, speech.pack === "installed") };
        });
        sessionRef.current = created.session;
        setSpaceName(created.space.name);
        setPack(speech.pack);
        setPhase("recording");
        await startRecording(created.session.id);
        setAnchor({ ms: 0, at: Date.now() });
        setRecorder("recording");
        if (speech.pack === "not_installed") {
          setPack("downloading");
          downloadSpeechPack()
            .then((status) => setPack(status.pack))
            .catch(() => setPack(null));
        }
      } catch (error) {
        // The session row was written before the recorder started; a recorder that never started leaves nothing.
        const failed = sessionRef.current;
        if (failed !== null) {
          sessionRef.current = null;
          writeDb((db) => deleteSessionRow(db, failed.id));
          deleteSessionFiles(failed.id);
        }
        Alert.alert("Couldn't start the recording.", messageOf(error), [{ text: "OK", onPress: () => router.back() }]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keeps the clock moving while recording.
  useEffect(() => {
    if (recorder !== "recording") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [recorder]);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  function attempt(promise: Promise<void>): void {
    promise.catch((error: unknown) => Alert.alert("Couldn't change the recording.", messageOf(error)));
  }

  function flag(): void {
    const current = sessionRef.current;
    if (!current) return;
    const t = Date.now() - current.startedAt;
    writeDb((db) => addFlag(db, deps, current.id, t));
    setFlags((previous) => [...previous, t]);
    setToast({ t });
  }

  async function photo(): Promise<void> {
    const current = sessionRef.current;
    if (!current) return;
    if (!isScannerSupported()) {
      Alert.alert("Photos aren't supported on this iPhone.");
      return;
    }
    try {
      for (const page of await scanPages(current.id)) {
        const t = Date.now() - current.startedAt;
        const id = writeDb((db) => addPhoto(db, deps, current.id, t, page.file));
        setPhotos((previous) => [...previous, { id, t, file: page.file }]);
      }
    } catch (error) {
      Alert.alert("Couldn't take the photo.", messageOf(error));
    }
  }

  async function stop(): Promise<void> {
    const current = sessionRef.current;
    if (!current || stoppingRef.current) return;
    stoppingRef.current = true;
    setStopping(true);
    try {
      const recordedMs = await stopRecording();
      writeDb((db) => {
        // Live words were lost part way through, so the audio files are written down afterwards.
        if (brokeRef.current) db.run("UPDATE sessions SET transcript = 'waiting' WHERE id = ? AND transcript = 'live'", [current.id]);
        finishRecording(db, current.id, Date.now(), recordedMs);
      });
      router.replace(`/session/${current.id}`);
    } catch (error) {
      stoppingRef.current = false;
      setStopping(false);
      Alert.alert("Couldn't stop the recording.", messageOf(error));
    }
  }

  const clockMs = anchor.ms + (recorder === "recording" ? Math.max(0, now - anchor.at) : 0);
  const bars = Array.from({ length: LEVELS_KEPT }, (_, i) => levels[levels.length - LEVELS_KEPT + i] ?? 0);

  let banner: Banner = null;
  if (pack === "unsupported") banner = { kind: "unsupported" };
  else if (pack === "downloading" || pack === "not_installed") banner = { kind: "downloading", percent: Math.round(fraction * 100) };

  return {
    phase,
    sessionId: sessionRef.current?.id ?? null,
    spaceName,
    recorder,
    pauseReason,
    clockMs,
    levels: bars,
    timeline: buildTimeline(live.finals, parts, resumes, flags, photos),
    volatile: live.volatile,
    banner,
    toast,
    stopping,
    pause: () => attempt(pauseRecording()),
    resume: () => attempt(resumeRecording()),
    flag,
    photo: () => void photo(),
    stop: () => void stop(),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
