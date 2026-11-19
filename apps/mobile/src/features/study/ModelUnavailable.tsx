import { Linking } from "react-native";
import { availabilityMessage, type Unavailable } from "../../core/study/labels.ts";
import { Body, PrimaryButton } from "../../ui/kit.tsx";

// What the Study screens show when the on-device model can't be used, and how to fix it when there is a fix.
export function ModelUnavailable({ availability }: { availability: Unavailable }) {
  return (
    <>
      <Body>{availabilityMessage(availability)}</Body>
      {availability === "apple_intelligence_off" ? <PrimaryButton label="Open Settings" onPress={() => void Linking.openSettings()} /> : null}
    </>
  );
}
