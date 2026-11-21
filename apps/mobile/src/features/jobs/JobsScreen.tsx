import { router } from "expo-router";
import { dateLine } from "../../core/capture/labels.ts";
import { JOB_LABELS, jobLine, listJobs } from "../../core/jobs/jobs.ts";
import { useQuery } from "../../platform/db.ts";
import { BackButton, Caption, Row, Screen, Title } from "../../ui/kit.tsx";

// Every job this iPhone started (things being made in the cloud), newest first. Tapping one opens its screen.
export default function JobsScreen() {
  const jobs = useQuery((db) => listJobs(db));
  const offset = -new Date().getTimezoneOffset();
  return (
    <Screen>
      <BackButton />
      <Title>Made for you</Title>
      {jobs.length === 0 ? <Caption>Nothing is being made yet.</Caption> : null}
      {jobs.map((job) => (
        <Row
          key={job.id}
          title={JOB_LABELS[job.type]}
          subtitle={jobLine(job)}
          right={<Caption>{dateLine(job.createdAt, offset)}</Caption>}
          onPress={() => router.push(`/job/${encodeURIComponent(job.id)}`)}
        />
      ))}
    </Screen>
  );
}

