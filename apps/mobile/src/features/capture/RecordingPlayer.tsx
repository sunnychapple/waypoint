import { useEffect, useState } from "react";
import { setAudioModeAsync, useAudioPlaylist, useAudioPlaylistStatus } from "expo-audio";
import { getRecorderStatus, onRecorderState } from "../../../modules/waypoint-audio/index.ts";
import { partAt, type PlayPart } from "../../core/capture/playback.ts";
import { formatOffset } from "../../core/format.ts";
import { fileUri } from "../../platform/files.ts";
import { Caption, PrimaryButton } from "../../ui/kit.tsx";

export type PlayFile = PlayPart & { file: string };

// Plays a session's own recording on this iPhone (open question 54): its parts in order. `seek` is set (a new object
// each time) when a transcript line's time is tapped: playback jumps there. Nothing plays while a recording runs.
export function RecordingPlayer({ parts, seek, onSeekDone }: { parts: PlayFile[]; seek: { ms: number } | null; onSeekDone: () => void }) {
  const playlist = useAudioPlaylist({ sources: parts.map((part) => fileUri(part.file)) });
  const status = useAudioPlaylistStatus(playlist);
  const [recording, setRecording] = useState(getRecorderStatus().state !== "idle");
  const at = (parts[status.currentIndex]?.startMs ?? 0) + status.currentTime * 1000;

  // A recording that starts while this screen is open stops the playback and blocks the play controls.
  useEffect(() => {
    const sub = onRecorderState((e) => {
      const busy = e.state !== "idle";
      setRecording(busy);
      if (busy) playlist.pause();
    });
    return () => sub.remove();
  }, [playlist]);

  async function play(from: number | null): Promise<void> {
    // Read now, not at render: a recording may have started since (its audio session must not be touched).
    if (getRecorderStatus().state !== "idle") return;
    try {
      // Heard with the silent switch on, as the overview player. Nothing else about the audio session changes.
      await setAudioModeAsync({ playsInSilentMode: true });
      const where = from === null ? null : partAt(parts, from);
      // Always skip first: a finished queue is empty and skipTo rebuilds it.
      playlist.skipTo(where?.index ?? 0);
      if (where !== null && where.offsetMs > 0) await playlist.seekTo(where.offsetMs / 1000);
      if (getRecorderStatus().state !== "idle") return;
      playlist.play();
    } catch {
      // Playback is best effort: a failed seek or audio mode leaves the button as it was.
    }
  }

  useEffect(() => {
    if (seek === null) return;
    void play(seek.ms);
    onSeekDone();
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
