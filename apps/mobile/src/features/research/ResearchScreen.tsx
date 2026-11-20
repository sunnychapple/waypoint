import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { dateLine } from "../../core/capture/labels.ts";
import { answerBlocks, openableUrl, type Block } from "../../core/research/answer.ts";
import { getResearch } from "../../core/research/research.ts";
import { useQuery } from "../../platform/db.ts";
import { openSource } from "../../platform/research.ts";
import { Caption, Row, Screen, Title } from "../../ui/kit.tsx";
import { useColors, type Colors } from "../../ui/theme.ts";

// One research answer as plain text: no HTML and no remote image. Sources open on a tap, in the in-app browser.
export default function ResearchScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useQuery((db) => getResearch(db, id), id);
  const offset = -new Date().getTimezoneOffset();

  if (item === null) {
    return (
      <Screen>
        <BackButton />
        <Title>Research</Title>
      </Screen>
    );
  }

  const blocks = answerBlocks(item.answer, item.sources.map((source) => source.n));

  return (
    <Screen>
      <BackButton />
      <Title>{item.question}</Title>
      <Caption>{dateLine(item.createdAt, offset)}</Caption>

      <View style={styles.block}>
        {blocks.map((block, index) => (
          <BlockView key={index} block={block} colors={colors} />
        ))}
      </View>

      {item.sources.length > 0 ? (
        <View style={styles.block}>
          <Caption style={styles.caps}>SOURCES</Caption>
          {item.sources.map((source) => (
            <Row
              key={source.n}
              title={source.title.trim() === "" ? hostOf(source.url) : source.title}
              subtitle={hostOf(source.url)}
              onPress={openableUrl(source.url) === null ? undefined : () => void openSource(source.url)}
            />
          ))}
        </View>
      ) : null}

      <Caption>Sent for this task only. Pages were read by Waypoint's cloud.</Caption>
    </Screen>
  );
}

function BlockView({ block, colors }: { block: Block; colors: Colors }) {
  const parts = block.parts.map((part, index) =>
    part.kind === "text" ? (
      <Text key={index}>{part.text}</Text>
    ) : (
      <Text key={index} style={[styles.cite, { color: colors.accent }]}>{`[${part.n}]`}</Text>
    ),
  );
  if (block.kind === "heading") return <Text style={[styles.heading, { color: colors.ink }]}>{parts}</Text>;
  if (block.kind === "bullet") {
    return (
      <View style={styles.bullet}>
        <Text style={[styles.body, { color: colors.ink3 }]}>•</Text>
        <Text style={[styles.body, styles.flex, { color: colors.ink }]}>{parts}</Text>
      </View>
    );
  }
  return <Text style={[styles.body, { color: colors.ink }]}>{parts}</Text>;
}

// The host of a web address, for a source's subtitle (the whole text when it is not a web address).
function hostOf(url: string): string {
  return /^https?:\/\/([^/?#\s]+)/i.exec(url.trim())?.[1] ?? url;
}

function BackButton() {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={() => router.back()}
      style={[styles.circle, { backgroundColor: colors.surface, borderColor: colors.line }]}
    >
      <SymbolView name="chevron.left" tintColor={colors.ink} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  circle: { width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  block: { gap: 12 },
  heading: { fontSize: 20, fontWeight: "700", lineHeight: 26 },
  body: { fontSize: 17, lineHeight: 25 },
  bullet: { flexDirection: "row", gap: 10, paddingLeft: 4 },
  flex: { flex: 1 },
  cite: { fontSize: 13, fontWeight: "600" },
  caps: { letterSpacing: 0.5 },
});
