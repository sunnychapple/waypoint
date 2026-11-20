import { useEffect } from "react";
import { setAudioModeAsync, useAudioPlaylist, useAudioPlaylistStatus } from "expo-audio";
import { getRecorderStatus } from "../../../modules/waypoint-audio/index.ts";
import { partAt, type PlayPart } from "../../core/capture/playback.ts";
import { formatOffset } from "../../core/format.ts";
import { fileUri } from "../../platform/files.ts";
import { Caption, PrimaryButton } from "../../ui/kit.tsx";

export type PlayFile = PlayPart & { file: string };

// Plays a session's own recording on this iPhone (open question 54): its parts in order. `seek` is set (a new object
// each time) when a transcript line's time is tapped: playback jumps there. Nothing plays while a recording runs.
export function RecordingPlayer({ parts, seek }: { parts: PlayFile[]; seek: { ms: number } | null }) {
  const playlist = useAudioPlaylist({ sources: parts.map((part) => fileUri(part.file)) });
  const status = useAudioPlaylistStatus(playlist);
  const recording = getRecorderStatus().state !== "idle";
  const at = (parts[status.currentIndex]?.startMs ?? 0) + status.currentTime * 1000;

  async function play(from: number | null): Promise<void> {
    if (recording) return;
    // Heard with the silent switch on, as the overview player. Nothing else about the audio session changes, and it is
    // set only when nothing records (the recorder keeps its own settings).
    await setAudioModeAsync({ playsInSilentMode: true });
    const where = from === null ? null : partAt(parts, from);
    if (where !== null) {
      if (where.index !== status.currentIndex) playlist.skipTo(where.index);
      await playlist.seekTo(where.offsetMs / 1000);
    }
    playlist.play();
  }

  useEffect(() => {
    if (seek !== null) void play(seek.ms);
  }, [seek]);

  return (
    <>
      <PrimaryButton
        label={recording ? "Stop the recording to play" : status.playing ? "Pause" : "Play the recording"}
        icon={status.playing ? "pause.fill" : "play.fill"}
        onPress={() => (status.playing ? playlist.pause() : void play(null))}
      />
      <Caption>{`${formatOffset(at)} · tap a time to play from there`}</Caption>
    </>
  );
}
