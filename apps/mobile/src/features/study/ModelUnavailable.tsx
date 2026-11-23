import { Linking } from "react-native";
import { router } from "expo-router";
import { availabilityMessage, CLOUD_PRACTICE_LINE, type Unavailable } from "../../core/study/labels.ts";
import { Body, PrimaryButton } from "../../ui/kit.tsx";

// What the Study screens show when the on-device model can't be used, and how to fix it when there is a fix.
// With sessionId, the states with no on-device model also point at the cloud Practice set for that session.
export function ModelUnavailable({ availability, sessionId }: { availability: Unavailable; sessionId?: string }) {
  const cloudPractice = sessionId !== undefined && (availability === "device_not_eligible" || availability === "apple_intelligence_off");
  return (
    <>
      <Body>{availabilityMessage(availability)}</Body>
      {availability === "apple_intelligence_off" ? <PrimaryButton label="Open Settings" onPress={() => void Linking.openSettings()} /> : null}
      {cloudPractice ? (
        <>
          <Body>{CLOUD_PRACTICE_LINE}</Body>
          <PrimaryButton label="Make with the cloud" icon="cloud" onPress={() => router.push(`/made/new?sessionId=${sessionId}&kind=practice`)} />
        </>
      ) : null}
    </>
  );
}
