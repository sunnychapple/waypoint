import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import * as Notifications from "expo-notifications";
import { failureCopy } from "../../core/cloud/failure.ts";
import { getJob, JOB_LABELS, jobLine, type LocalJob } from "../../core/jobs/jobs.ts";
import { useQuery } from "../../platform/db.ts";
import { askForPush } from "../../platform/push.ts";
import { cancelJob, followJob } from "../../platform/jobs.ts";
import { RESULT_ROUTES } from "../../platform/jobResults.ts";
import { BackButton, Body, Caption, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

// "Try again" for a failed job: the screen that makes this kind, with the same session (and the same question for
// research), so the price is quoted again and the person taps Make. The job keeps no request body to re-send.
function retryHref(job: LocalJob): string | null {
  let detail: { question?: unknown; kind?: unknown } = {};
  try {
    detail = JSON.parse(job.detail) as typeof detail;
  } catch {
    detail = {};
  }
  const query = new URLSearchParams();
  if (job.sessionId !== null) query.set("sessionId", job.sessionId);
  switch (job.type) {
    case "research":
      if (typeof detail.question === "string") query.set("q", detail.question);
      return `/research/new?${query.toString()}`;
    case "overview_script":
      return job.sessionId !== null ? `/overview/new?${query.toString()}` : null;
    case "video_slides":
      return job.sessionId !== null ? `/video/new?${query.toString()}` : null;
    case "practice":
    case "diagram":
    case "mini_app":
      if (job.sessionId === null) return null;
      query.set("kind", job.type);
      return `/made/new?${query.toString()}`;
    case "retranscribe":
      return job.sessionId !== null ? `/second-transcript?${query.toString()}` : null;
  }
}

// One cloud job: its state, its result when it is saved, and cancel while it runs.
export default function JobScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const job = useQuery((db) => getJob(db, id), id);
  const [notifications, setNotifications] = useState<boolean | null>(null);

  useFocusEffect(
    useCallback(() => {
      void followJob(id);
    }, [id]),
  );

  useEffect(() => {
    void Notifications.getPermissionsAsync().then(
      ({ status }) => setNotifications(status === "granted"),
      () => setNotifications(null),
    );
  }, []);

  if (job === null) {
    return (
      <Screen>
        <BackButton />
        <Title>Being made</Title>
        <Caption>This job isn't on this iPhone.</Caption>
      </Screen>
    );
  }

  const route = RESULT_ROUTES[job.type];
  const retry = job.problem === null && job.state === "failed" ? retryHref(job) : null;
  const running = job.state === "queued" || job.state === "running";

  function confirmCancel() {
    Alert.alert("Stop making this?", "Nothing is charged unless it has already finished.", [
      { text: "Keep waiting", style: "cancel" },
      {
        text: "Stop making this",
        style: "destructive",
        onPress: () =>
          void cancelJob(id).then((failure) => {
            if (failure !== null) Alert.alert(failureCopy(failure).title, failureCopy(failure).body);
          }),
      },
    ]);
  }

  async function allowNotifications() {
    setNotifications(await askForPush());
  }

  return (
    <Screen>
      <BackButton />
      <Title>{JOB_LABELS[job.type]}</Title>
      <Caption>{jobLine(job)}</Caption>

      {running ? (
        <View style={styles.block}>
          <Body>Working on it. You can leave this screen; you'll get a notification when it's ready.</Body>
          <ActivityIndicator color={colors.accent} />
          {notifications === false ? <SecondaryButton label="Notify me" icon="bell" tone="accent" onPress={() => void allowNotifications()} /> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={confirmCancel} style={styles.link}>
            <Text style={[styles.linkText, { color: colors.danger }]}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}

      {job.problem === "unreadable" ? (
        <Body>The result arrived but couldn't be opened on this iPhone, because who can see this space changed.</Body>
      ) : null}
      {job.problem === null && job.state === "succeeded" && job.savedAt !== null && route !== undefined ? (
        <PrimaryButton label="Open" onPress={() => router.push(route(job))} />
      ) : null}
      {job.problem === null && job.state === "failed" ? (
        <View style={styles.block}>
          <Body>It didn't work. Nothing was charged.</Body>
          {retry !== null ? <PrimaryButton label="Try again" onPress={() => router.push(retry)} /> : null}
        </View>
      ) : null}
      {job.problem === null && job.state === "cancelled" ? <Body>{jobLine(job)}</Body> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { gap: 16 },
  link: { minHeight: 44, justifyContent: "center", alignItems: "center" },
  linkText: { fontSize: 17, fontWeight: "600" },
});
