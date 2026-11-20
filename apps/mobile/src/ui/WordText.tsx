import { Text, type StyleProp, type TextStyle } from "react-native";
import { splitWords } from "../core/explain/excerpt.ts";

// A transcript line whose words can be tapped (D1). Spaces and punctuation are plain text.
export function WordText({ text, style, onWord }: { text: string; style?: StyleProp<TextStyle>; onWord: (word: string) => void }) {
  return (
    <Text style={style} accessibilityHint="Tap a word to explain it">
      {splitWords(text).map((token, index) =>
        token.word === null ? (
          token.text
        ) : (
          <Text key={index} onPress={() => onWord(token.word ?? "")} suppressHighlighting={false}>
            {token.text}
          </Text>
        ),
      )}
    </Text>
  );
}
