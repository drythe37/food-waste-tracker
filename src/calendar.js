import { APP_SETTINGS } from "./config";

// Creates a calendar event using the user's OAuth access token
export async function createCalendarReminder(item, accessToken) {
  const expiryDate = new Date(item.expiry);
  const reminderDate = new Date(expiryDate);
  reminderDate.setDate(reminderDate.getDate() - APP_SETTINGS.reminderDaysBefore);

  const dateStr = reminderDate.toISOString().split("T")[0];
  const startTime = `${dateStr}T08:00:00`;
  const endTime = `${dateStr}T08:15:00`;

  const event = {
    summary: `🍽️ Use soon: ${item.name}`,
    description: `Expires on ${item.expiry}.\n${item.quantity ? `Quantity: ${item.quantity}\n` : ""}${item.notes ? `Notes: ${item.notes}` : ""}`,
    start: { dateTime: startTime, timeZone: "Europe/London" },
    end: { dateTime: endTime, timeZone: "Europe/London" },
    colorId: "6", // Tangerine/orange
    attendees: APP_SETTINGS.householdEmails.map(email => ({ email })),
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 0 },
        { method: "popup", minutes: 0 }
      ]
    }
  };

  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(event)
    }
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || "Calendar API error");
  }

  return await response.json();
}
