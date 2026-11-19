import { requireNativeModule } from "expo";

type NativeWaypointEmbed = {
  getModel(): { available: boolean; modelVersion: string; dimension: number };
  embed(texts: string[]): Promise<number[][]>;
};

const native = requireNativeModule<NativeWaypointEmbed>("WaypointEmbed");

export function getModel(): { available: boolean; modelVersion: string; dimension: number } {
  return native.getModel();
}

// An empty array for a text means "no vector for this text".
export function embed(texts: string[]): Promise<number[][]> {
  return native.embed(texts);
}
