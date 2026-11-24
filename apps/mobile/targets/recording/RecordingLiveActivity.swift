import ActivityKit
import SwiftUI
import WidgetKit

@main
struct RecordingWidgets: WidgetBundle {
  var body: some Widget { RecordingLiveActivity() }
}

/// The recording on the Lock Screen and in the Dynamic Island. Tapping it opens NotePath, where the recording screen
/// is still open. It has no buttons and no level strip: both would need the app to send updates while recording.
struct RecordingLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
      LockScreenView(state: context.state)
        .activityBackgroundTint(nil)
        .activitySystemActionForegroundColor(.red)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          StatusLabel(state: context.state).padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Clock(state: context.state).font(.title3.monospacedDigit()).padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(place(context.state)).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
        }
      } compactLeading: {
        Dot(state: context.state)
      } compactTrailing: {
        Clock(state: context.state).font(.caption.monospacedDigit()).lineLimit(1).minimumScaleFactor(0.7).frame(maxWidth: 52)
      } minimal: {
        Dot(state: context.state)
      }
    }
  }
}

private struct LockScreenView: View {
  let state: RecordingActivityAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .firstTextBaseline) {
        StatusLabel(state: state)
        Spacer()
        Clock(state: state).font(.title2.monospacedDigit().weight(.semibold))
      }
      Text(place(state)).font(.subheadline).lineLimit(1)
      Text(state.paused ? "Tap to resume" : "Tap to pause or stop").font(.caption).foregroundStyle(.secondary)
    }
    .padding(16)
    .accessibilityElement(children: .combine)
  }
}

private struct StatusLabel: View {
  let state: RecordingActivityAttributes.ContentState

  var body: some View {
    HStack(spacing: 6) {
      Dot(state: state).accessibilityHidden(true)   // the label next to it says the same
      Text(state.paused ? "Paused" : "Recording").font(.headline)
    }
  }
}

/// Red while recording; a pause sign while paused.
private struct Dot: View {
  let state: RecordingActivityAttributes.ContentState

  var body: some View {
    if state.paused {
      Image(systemName: "pause.circle.fill").foregroundStyle(.orange).accessibilityLabel("Paused")
    } else {
      Circle().fill(.red).frame(width: 10, height: 10).accessibilityLabel("Recording")
    }
  }
}

/// Counts by itself while recording and stands still while paused, so the app never sends an update for the clock.
private struct Clock: View {
  let state: RecordingActivityAttributes.ContentState

  var body: some View {
    // The end of the range sets the widest time the text makes room for. iOS ends an activity after 8 hours and may show it up to 4 hours more.
    Text(
      timerInterval: state.clockStart...state.clockStart.addingTimeInterval(24 * 3600),
      pauseTime: state.pausedAt,
      countsDown: false,
      showsHours: true)
      .multilineTextAlignment(.trailing)
  }
}

private func place(_ state: RecordingActivityAttributes.ContentState) -> String {
  state.place.isEmpty ? state.title : "\(state.title) · \(state.place)"
}
