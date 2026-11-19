import { NativeModule, requireNativeModule, type EventSubscription } from "expo";

export type MicPermission = "granted" | "denied" | "undetermined";
export type RecorderState = "idle" | "recording" | "paused";
export type PauseReason = "none" | "user" | "interruption" | "route_change" | "media_reset";
export type StateEvent = { sessionId: string; state: RecorderState; reason: PauseReason; recordedMs: number };
export type PartEvent = { sessionId: string; index: number; startMs: number; durationMs: number; file: string };
export type LevelEvent = { level: number };
export type RecorderStatus = { sessionId: string; state: RecorderState; recordedMs: number };
export type SpeechStatus = {
  engine: "transcriber" | "dictation";
  locale: string;
  pack: "installed" | "downloading" | "not_installed" | "unsupported";
};
export type TranscriptEvent = { sessionId: string; tStart: number; tEnd: number; text: string; isFinal: boolean };
export type TranscriptPiece = Omit<TranscriptEvent, "sessionId">;
export type SpeechErrorEvent = { sessionId: string; message: string };
export type SpeechPackEvent = { fraction: number };

type Events = {
  onState(event: StateEvent): void;
  onPart(event: PartEvent): void;
  onLevel(event: LevelEvent): void;
  onTranscript(event: TranscriptEvent): void;
  onSpeechError(event: SpeechErrorEvent): void;
  onSpeechPack(event: SpeechPackEvent): void;
};

declare class WaypointAudioNative extends NativeModule<Events> {
  getMicPermission(): Promise<MicPermission>;
  requestMicPermission(): Promise<MicPermission>;
  start(sessionId: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<number>;
  getStatus(): RecorderStatus;
  getSpeechStatus(): Promise<SpeechStatus>;
  downloadSpeechPack(): Promise<SpeechStatus>;
  transcribeFile(file: string, startMs: number): Promise<TranscriptPiece[]>;
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
export const getSpeechStatus = (): Promise<SpeechStatus> => native.getSpeechStatus();
export const downloadSpeechPack = (): Promise<SpeechStatus> => native.downloadSpeechPack();
export const transcribeFile = (file: string, startMs: number): Promise<TranscriptPiece[]> => native.transcribeFile(file, startMs);
export const onTranscript = (l: (e: TranscriptEvent) => void): EventSubscription => native.addListener("onTranscript", l);
export const onSpeechError = (l: (e: SpeechErrorEvent) => void): EventSubscription => native.addListener("onSpeechError", l);
export const onSpeechPackProgress = (l: (e: SpeechPackEvent) => void): EventSubscription => native.addListener("onSpeechPack", l);
