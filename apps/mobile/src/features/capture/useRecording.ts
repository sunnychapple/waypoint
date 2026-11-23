import { useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import {
  downloadSpeechPack,
  getMicPermission,
  getSpeechStatus,
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
import { SECOND_ALWAYS_KEY } from "../../core/capture/second.ts";
import { addPiece, EMPTY_LIVE, type LiveTranscript, type Piece } from "../../core/capture/transcript.ts";
import { getSetting } from "../../core/db/settings.ts";
import {
  addFlag,
  addPhoto,
  continueRecordingSession,
  DEFAULT_RECORDING_TITLE,
  finishRecording,
  nameRecording,
  savePart,
  saveSegment,
  setPaused,
  startRecordingSession,
  undoContinue,
  type ContinuedRecording,
} from "../../core/capture/recording.ts";
import { deleteSessionRow, type SessionRow } from "../../core/capture/sessions.ts";
import { buildTimeline, type TimelineItem } from "../../core/capture/timeline.ts";
import { getSavingTo, getSpace } from "../../core/db/spaces.ts";
import { writeDb } from "../../platform/db.ts";
import { deleteSessionFiles } from "../../platform/files.ts";
import { askForPush } from "../../platform/push.ts";

const deps = { now: Date.now, newId: randomUUID };
const TOAST_MS = 2000;

export type { TimelineItem };

export type Banner = { kind: "downloading"; percent: number } | { kind: "unsupported" } | null;

export type RecordingModel = {
  phase: "checking" | "denied" | "recording";
  sessionId: string | null;
  spaceName: string;
  title: string;
  continuing: boolean;
  recorder: RecorderState;
  pauseReason: PauseReason;
  clockMs: number;
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
  discard: () => void;
};

type Photo = { id: string; t: number; file: string };

// The live recording screen. Native events go to SQLite as they happen, and the screen state is kept here.
export function useRecording(): RecordingModel {
  const { continue: continueId } = useLocalSearchParams<{ continue?: string }>();
  const [title, setTitle] = useState(DEFAULT_RECORDING_TITLE);
  const [phase, setPhase] = useState<RecordingModel["phase"]>("checking");
  const [spaceName, setSpaceName] = useState("");
  const [recorder, setRecorder] = useState<RecorderState>("idle");
  const [pauseReason, setPauseReason] = useState<PauseReason>("none");
  const [anchor, setAnchor] = useState({ ms: 0, at: 0 });
  const [now, setNow] = useState(() => Date.now());
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
  const continuedRef = useRef<ContinuedRecording | null>(null);
  // Added to Date.now() - startedAt so marks use the recorder's timeline, which can differ if the iPhone's clock moved.
  const clockOffsetRef = useRef(0);
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
        if (e.state === "recording" && started !== undefined) setResumes((previous) => [...previous, Date.now() - started + clockOffsetRef.current]);
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
    const removeAll = (): void => {
      for (const subscription of subscriptions) subscription.remove();
    };
    // The screen can go away while recording without Stop being tapped (the session ended and the app went back to
    // sign-in). Then the recording is stopped and saved here, so the microphone does not run on with nothing to stop it.
    // The listeners stay until the stop settles: the last audio part and the last words arrive during stopRecording.
    return () => {
      const current = sessionRef.current;
      if (current === null || stoppingRef.current) {
        removeAll();
        return;
      }
      stoppingRef.current = true;
      stopRecording()
        .then(
          (recordedMs) =>
            writeDb((db) => {
              if (brokeRef.current) db.run("UPDATE sessions SET transcript = 'waiting' WHERE id = ? AND transcript = 'live'", [current.id]);
              finishRecording(db, current.id, Date.now(), recordedMs);
              nameRecording(db, current.id);
            }),
          () => undefined, // never started, or already stopped: the next launch's recoverSessions marks it interrupted
        )
        .catch(() => undefined) // a failed save: recoverSessions marks it interrupted at the next launch
        .finally(removeAll);
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
          if (continueId === undefined) {
            const space = getSavingTo(db);
            return { spaceName: space.name, session: startRecordingSession(db, deps, space.id, speech.pack === "installed"), continued: null };
          }
          const continued = continueRecordingSession(db, deps, continueId, speech.pack === "installed");
          if (continued === null) return null;
          return { spaceName: getSpace(db, continued.session.spaceId)?.name ?? "", session: continued.session, continued };
        });
        if (created === null) {
          Alert.alert("Couldn't continue this recording.", undefined, [{ text: "OK", onPress: () => router.back() }]);
          return;
        }
        sessionRef.current = created.session;
        continuedRef.current = created.continued;
        if (created.continued !== null) {
          const { prior, from } = created.continued;
          clockOffsetRef.current = from.elapsedMs - (Date.now() - created.session.startedAt);
          setTitle(created.session.title);
          setLive({ finals: prior.finals, volatile: null });
          setParts(prior.parts);
          setResumes(prior.resumes);
          setFlags(prior.flags);
          setPhotos(prior.photos);
          setAnchor({ ms: from.priorRecordedMs, at: Date.now() });
        }
        setSpaceName(created.spaceName);
        setPack(speech.pack);
        setPhase("recording");
        await startRecording(created.session.id, created.continued?.from);
        if (sessionRef.current?.id !== created.session.id) {
          // Discarded while the recorder was starting: the session is already gone, so only the microphone is left.
          stopRecording()
            .catch(() => undefined)
            .finally(() => deleteSessionFiles(created.session.id));
          return;
        }
        if (cancelled) {
          // The screen went away while the recorder was starting, so the unmount stop came too early. Stop it now.
          // A new session stays unfinished and the next launch's recoverSessions marks it interrupted. A continued one
          // goes back to how it was, so it is not left looking like it is still recording.
          const reopened = continuedRef.current;
          const sessionId = created.session.id;
          stopRecording()
            .catch(() => undefined)
            .finally(() => {
              if (reopened !== null) writeDb((db) => undoContinue(db, sessionId, reopened.restore));
            });
          return;
        }
        setAnchor({ ms: created.continued?.from.priorRecordedMs ?? 0, at: Date.now() });
        setRecorder("recording");
        // The pause alert needs this. iOS shows its prompt only once, and the recording runs on behind it.
        askForPush().catch(() => undefined);
        if (speech.pack === "not_installed") {
          setPack("downloading");
          downloadSpeechPack()
            .then((status) => setPack(status.pack))
            .catch(() => setPack(null));
        }
      } catch (error) {
        // The session row was written before the recorder started; a recorder that never started leaves nothing.
        const failed = sessionRef.current;
        if (failed === null) return; // discarded meanwhile: nothing to report
        sessionRef.current = null;
        const continued = continuedRef.current;
        if (continued !== null) {
          // A session that already held a recording keeps it.
          writeDb((db) => undoContinue(db, failed.id, continued.restore));
        } else {
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
    const t = Date.now() - current.startedAt + clockOffsetRef.current;
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
        const t = Date.now() - current.startedAt + clockOffsetRef.current;
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
        nameRecording(db, current.id);
      });
      // A continued recording was opened from its session, so going back lands there.
      if (continuedRef.current !== null) router.back();
      else router.replace(`/session/${current.id}`);
      // A continued session is not sent again automatically: that would quote and charge for all of it.
      if (continuedRef.current === null && writeDb((db) => getSetting(db, SECOND_ALWAYS_KEY)) === "1") router.push(`/second-transcript?sessionId=${current.id}`);
    } catch (error) {
      stoppingRef.current = false;
      setStopping(false);
      Alert.alert("Couldn't stop the recording.", messageOf(error));
    }
  }

  // Stops the microphone, then deletes the session with its audio, photos and words. Nothing is kept.
  async function discard(): Promise<void> {
    const current = sessionRef.current;
    if (!current || stoppingRef.current) return;
    if (continuedRef.current !== null) return; // discarding would delete what was already saved
    stoppingRef.current = true;
    setStopping(true);
    // A recorder that is not running has nothing to stop (the same reading as the unmount stop above).
    await stopRecording().catch(() => undefined);
    // Late native events for this session are ignored from here on.
    sessionRef.current = null;
    try {
      // Rows go first: with the row gone nothing can list the files, and a synced row leaves a delete for the other devices.
      writeDb((db) => deleteSessionRow(db, current.id));
      deleteSessionFiles(current.id);
    } catch {
      // A row left behind is marked interrupted at the next launch; the person still gets out of the screen.
    }
    router.back();
  }

  const clockMs = anchor.ms + (recorder === "recording" ? Math.max(0, now - anchor.at) : 0);
  const timeline = useMemo(() => buildTimeline(live.finals, parts, resumes, flags, photos), [live.finals, parts, resumes, flags, photos]);

  let banner: Banner = null;
  if (pack === "unsupported") banner = { kind: "unsupported" };
  else if (pack === "downloading" || pack === "not_installed") banner = { kind: "downloading", percent: Math.round(fraction * 100) };

  return {
    phase,
    sessionId: sessionRef.current?.id ?? null,
    spaceName,
    title,
    continuing: continueId !== undefined,
    recorder,
    pauseReason,
    clockMs,
    timeline,
    volatile: live.volatile,
    banner,
    toast,
    stopping,
    pause: () => attempt(pauseRecording()),
    resume: () => {
      resumeRecording().catch(() => {
        if (pauseReason === "write_failed") Alert.alert("Your iPhone still can't save the recording.", "Free up some space, then resume.");
        else Alert.alert("The microphone is still in use.", "Try again when the other app is finished.");
      });
    },
    flag,
    photo: () => void photo(),
    stop: () => void stop(),
    discard: () => void discard(),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
