import { requireNativeView } from "expo";
import type { StyleProp, ViewStyle } from "react-native";

// A locked web view (M25b): no network, no storage, no bridge, no navigation. `page` is a full HTML document;
// `mermaid` puts Mermaid's bundled script in place of its marker. The view sends nothing back to JavaScript.
type NativeSandboxProps = { page: string; mermaid: boolean; style: StyleProp<ViewStyle> };
const NativeSandbox = requireNativeView<NativeSandboxProps>("WaypointSandbox");

export function SandboxView({ page, mermaid, style }: NativeSandboxProps) {
  return <NativeSandbox page={page} mermaid={mermaid} style={style} />;
}
