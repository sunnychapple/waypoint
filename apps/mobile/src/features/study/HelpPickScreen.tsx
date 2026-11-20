import { useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { groupBlocks, parseLines, type Block } from "../../core/pages/blocks.ts";
import { pagesWithLines, type PageWithLines } from "../../core/study/help.ts";
import { useQuery } from "../../platform/db.ts";
import { fileUri } from "../../platform/files.ts";
import { getAvailability } from "../../../modules/waypoint-model/index.ts";
import { Caption, Screen, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";
import { ModelUnavailable } from "./ModelUnavailable.tsx";

// Each page full width, with its problems drawn as tappable outlines. Tapping one opens its steps.
export default function HelpPickScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [availability] = useState(getAvailability);
  const pages = useQuery((db) => pagesWithLines(db, sessionId), sessionId);

  if (availability !== "available") {
    return (
      <Screen>
        <CloseButton />
        <ModelUnavailable availability={availability} />
      </Screen>
    );
  }

  return (
    <Screen>
      <CloseButton />
      <Title>Tap a problem</Title>
      {pages.map((page) => (
        <PageProblems key={page.id} sessionId={sessionId} page={page} />
      ))}
    </Screen>
  );
}

function PageProblems({ sessionId, page }: { sessionId: string; page: PageWithLines }) {
  const colors = useColors();
  const [ratio, setRatio] = useState(1 / 1.4);
  if (page.found_text === null) return <Caption>Reading this page…</Caption>;
  const blocks: Block[] = groupBlocks(parseLines(page.found_lines));
  return (
    <View style={[styles.frame, { aspectRatio: ratio }]}>
      <Image
        source={{ uri: fileUri(page.file) }}
        resizeMode="contain"
        style={styles.image}
        onLoad={(event) => setRatio(event.nativeEvent.source.width / event.nativeEvent.source.height)}
      />
      {blocks.map((block, index) => (
        <Pressable
          key={`${page.id}-${index}`}
          accessibilityRole="button"
          accessibilityLabel={`Problem ${index + 1}`}
          onPress={() => router.push(`/study/help-steps?sessionId=${sessionId}&captureId=${page.id}&block=${index}`)}
          style={[
            styles.outline,
            {
              left: `${block.x * 100}%`,
              top: `${block.y * 100}%`,
              width: `${block.width * 100}%`,
              height: `${block.height * 100}%`,
              borderColor: colors.accent,
            },
          ]}
        />
      ))}
    </View>
  );
}

function CloseButton() {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => router.back()} style={[styles.close, { backgroundColor: colors.surface }]}>
      <SymbolView name="xmark" tintColor={colors.ink} size={16} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  close: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  frame: { width: "100%" },
  image: { width: "100%", height: "100%" },
  outline: { position: "absolute", borderWidth: 2, borderRadius: 8 },
});
