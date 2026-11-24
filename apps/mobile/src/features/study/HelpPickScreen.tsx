import { useState } from "react";
import { Image, Pressable, StyleSheet, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { groupBlocks, parseLines, type Block } from "../../core/pages/blocks.ts";
import { pagesWithLines, type PageWithLines } from "../../core/study/help.ts";
import { useQuery } from "../../platform/db.ts";
import { fileUri } from "../../platform/files.ts";
import { getAvailability } from "../../../modules/waypoint-model/index.ts";
import { Body, Caption, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";
import { ModelUnavailable } from "./ModelUnavailable.tsx";

// Each page full width, with its problems drawn as tappable outlines. Tapping one opens its steps (or, without the
// on-device model, the cloud screen for it).
// A page with no problems found says so, and offers a retake or a problem typed in.
export default function HelpPickScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [availability] = useState(getAvailability);
  const pages = useQuery((db) => pagesWithLines(db, sessionId), sessionId);

  // Without the on-device model, a tapped problem goes straight to the cloud screen, which shows the price before anything is sent.
  const help = availability === "available" ? "/study/help-steps" : "/study/help-cloud";

  return (
    <Screen>
      <CloseButton />
      {availability !== "available" ? (
        <>
          <ModelUnavailable availability={availability} />
          <Body>You can still get help from NotePath's cloud (uses credits).</Body>
        </>
      ) : null}
      <Title>Tap a problem</Title>
      {pages.map((page) => (
        <PageProblems key={page.id} sessionId={sessionId} page={page} help={help} />
      ))}
    </Screen>
  );
}

function PageProblems({ sessionId, page, help }: { sessionId: string; page: PageWithLines; help: string }) {
  const colors = useColors();
  const [ratio, setRatio] = useState(1 / 1.4);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  if (page.found_text === null) return <Caption>Reading this page…</Caption>;
  const blocks: Block[] = groupBlocks(parseLines(page.found_lines));
  return (
    <>
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
            onPress={() => router.push(`${help}?sessionId=${sessionId}&captureId=${page.id}&block=${index}`)}
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
      {blocks.length > 0 ? null : (
        <View style={styles.empty}>
          <Body>Couldn't find a problem on this page.</Body>
          <SecondaryButton label="Retake the page" onPress={() => router.push(`/pages/new?sessionId=${sessionId}`)} />
          {typing ? null : <SecondaryButton label="Type the problem" onPress={() => setTyping(true)} />}
          {typing ? (
            <>
              <TextInput
                accessibilityLabel="The problem"
                value={typed}
                onChangeText={setTyped}
                placeholder="Type the problem here"
                placeholderTextColor={colors.ink4}
                multiline
                maxLength={500}
                autoFocus
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.ink }]}
              />
              {typed.trim() === "" ? null : (
                <PrimaryButton
                  label="Help me"
                  onPress={() =>
                    router.push(`${help}?sessionId=${sessionId}&captureId=${page.id}&text=${encodeURIComponent(typed.trim())}`)
                  }
                />
              )}
            </>
          ) : null}
        </View>
      )}
    </>
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
  empty: { gap: 12 },
  input: { minHeight: 56, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14, fontSize: 17 },
});
