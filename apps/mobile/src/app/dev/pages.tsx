import { useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { File, Paths } from "expo-file-system";
import { isScannerSupported, readPage, scanPages, type ScannedPage } from "../../../modules/waypoint-pages/index.ts";
import { groupBlocks } from "../../core/pages/blocks.ts";
import { useColors } from "../../ui/theme.ts";

const SESSION_ID = "dev-pages";

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function DevPages() {
  const colors = useColors();
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [message, setMessage] = useState("");
  const [text, setText] = useState("");
  const [blockCount, setBlockCount] = useState<number | null>(null);

  async function scan() {
    if (!isScannerSupported()) {
      setMessage("The document camera is not supported on this device");
      return;
    }
    try {
      const scanned = await scanPages(SESSION_ID);
      setPages(scanned);
      setMessage(`${scanned.length} page(s) scanned`);
    } catch (e) {
      setMessage(messageOf(e));
    }
  }

  async function readFirst() {
    const first = pages[0];
    if (!first) {
      setMessage("Scan a page first");
      return;
    }
    try {
      const page = await readPage(first.file);
      setText(page.text);
      setBlockCount(groupBlocks(page.lines).length);
      setMessage("Read the first page");
    } catch (e) {
      setMessage(messageOf(e));
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Pressable onPress={scan} style={{ backgroundColor: colors.accent, borderRadius: 12, padding: 14 }}>
        <Text style={{ color: colors.onAccent, fontWeight: "600", textAlign: "center" }}>Scan</Text>
      </Pressable>
      <Pressable onPress={readFirst} style={{ backgroundColor: colors.surface2, borderRadius: 12, padding: 14 }}>
        <Text style={{ color: colors.ink, fontWeight: "600", textAlign: "center" }}>Read first page</Text>
      </Pressable>
      {message ? <Text style={{ color: colors.ink2 }}>{message}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {pages.map((page) => (
            <Image
              key={page.file}
              source={{ uri: new File(Paths.document, page.file).uri }}
              style={{ width: 120, height: 160, borderRadius: 8, backgroundColor: colors.surface3 }}
            />
          ))}
        </View>
      </ScrollView>
      {blockCount !== null ? <Text style={{ color: colors.ink3 }}>{blockCount} blocks</Text> : null}
      {text ? <Text selectable style={{ color: colors.ink }}>{text}</Text> : null}
    </ScrollView>
  );
}
