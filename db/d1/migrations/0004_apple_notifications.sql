-- App Store Server Notifications already handled (PR 18), so a repeated notificationUUID does nothing.
-- Holds only the id, the type and when it was handled; never the signed payload.
CREATE TABLE apple_notifications (
  notification_uuid TEXT NOT NULL PRIMARY KEY,
  notification_type TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
