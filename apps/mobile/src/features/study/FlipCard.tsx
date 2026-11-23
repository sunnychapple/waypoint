import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { splitCardText } from "../../core/study/cards.ts";
import { Caption } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

type Face = "front" | "back";

const HALF_TURN_MS = 125;
const FADE_MS = 75;
const SPRING = { damping: 18, stiffness: 190, mass: 1, useNativeDriver: true } as const;

// Whether the system Reduce Motion setting is on, kept up to date while mounted.
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (active) setReduceMotion(on);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduceMotion;
}

type Props = { kindLabel: string; front: string; back: string; flipped: boolean; onPress: () => void };

// One card that turns on its Y axis to show the answer. Only the current face is rendered.
export function FlipCard({ kindLabel, front, back, flipped, onPress }: Props) {
  const colors = useColors();
  const reduceMotion = useReduceMotion();
  const reduceRef = useRef(reduceMotion);
  const [face, setFace] = useState<Face>(flipped ? "back" : "front");
  const faceRef = useRef<Face>(face);
  const targetRef = useRef(flipped);
  const [rotation] = useState(() => new Animated.Value(0));
  const [opacity] = useState(() => new Animated.Value(1));
  const runningRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    reduceRef.current = reduceMotion;
  }, [reduceMotion]);

  useEffect(() => () => runningRef.current?.stop(), []);

  useEffect(() => {
    if (targetRef.current === flipped) return;
    targetRef.current = flipped;
    runningRef.current?.stop();

    const next: Face = flipped ? "back" : "front";
    const needsSwap = faceRef.current !== next;

    function run(animation: Animated.CompositeAnimation, done?: (result: { finished: boolean }) => void) {
      runningRef.current = animation;
      animation.start(done);
    }

    function swapTo(to: Face) {
      faceRef.current = to;
      setFace(to);
      if (to === "back") AccessibilityInfo.announceForAccessibility(back);
    }

    if (reduceRef.current) {
      rotation.setValue(0);
      if (!needsSwap) {
        run(Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: true }));
        return;
      }
      run(Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }), ({ finished }) => {
        if (!finished) return;
        swapTo(next);
        run(Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: true }));
      });
      return;
    }

    if (!needsSwap) {
      run(Animated.spring(rotation, { toValue: 0, ...SPRING }));
      return;
    }
    run(Animated.timing(rotation, { toValue: 90, duration: HALF_TURN_MS, useNativeDriver: true }), ({ finished }) => {
      if (!finished) return;
      swapTo(next);
      rotation.setValue(-90);
      run(Animated.spring(rotation, { toValue: 0, ...SPRING }));
    });
    // Only `flipped` starts an animation; the other values are read through refs.
  }, [flipped]);

  const rotateY = rotation.interpolate({ inputRange: [-90, 0, 90], outputRange: ["-90deg", "0deg", "90deg"] });

  const frontText = splitCardText(front);
  const backText = splitCardText(back);
  return (
    <Animated.View style={{ opacity, transform: [{ perspective: 800 }, { rotateY }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={face === "front" ? front : `Question: ${front}. Answer: ${back}`}
        accessibilityHint="Double-tap to flip"
        onPress={onPress}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}
      >
        {face === "front" ? (
          <View style={styles.content}>
            <Caption>{kindLabel}</Caption>
            <Text style={[styles.front, frontText.rest !== null ? styles.frontWithChoices : null, { color: colors.ink }]}>{frontText.main}</Text>
            {frontText.rest !== null ? <Text style={[styles.support, { color: colors.ink }]}>{frontText.rest}</Text> : null}
          </View>
        ) : (
          <View style={styles.content}>
            <Caption>ANSWER</Caption>
            <Text style={[styles.question, { color: colors.ink2 }]}>{front}</Text>
            <Text style={[styles.answer, { color: colors.ink }]}>{backText.main}</Text>
            {backText.rest !== null ? <Text style={[styles.question, { color: colors.ink2 }]}>{backText.rest}</Text> : null}
          </View>
        )}
        <View style={styles.hint}>
          <SymbolView name="arrow.up.arrow.down" tintColor={colors.ink3} size={14} />
          <Caption>{face === "front" ? "Tap to flip" : "Tap to see the question"}</Caption>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 300, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 24, justifyContent: "space-between", gap: 20 },
  content: { flex: 1, alignItems: "center", justifyContent: "center", gap: 20 },
  front: { fontFamily: "Georgia", fontSize: 30, fontWeight: "700", textAlign: "center", lineHeight: 38 },
  frontWithChoices: { fontSize: 22, lineHeight: 29 },
  support: { fontSize: 17, lineHeight: 25, alignSelf: "stretch" },
  question: { fontSize: 16, textAlign: "center", lineHeight: 22 },
  answer: { fontFamily: "Georgia", fontSize: 24, fontWeight: "700", textAlign: "center", lineHeight: 32 },
  hint: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
});
