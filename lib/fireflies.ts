import "server-only";

const FIREFLIES_API_URL = "https://api.fireflies.ai/graphql";

export async function inviteFirefliesBot(meetingUrl: string): Promise<boolean> {
  const apiKey = process.env.FIREFLIES_API_KEY;
  if (!apiKey) {
    throw new Error("Missing FIREFLIES_API_KEY");
  }

  // NOTE: This is a representative GraphQL mutation for inviting Fireflies to a meeting.
  // The exact schema might require a title or start time depending on the Fireflies tier.
  const query = `
    mutation inviteBotToMeeting($meetingUrl: String!) {
      addToLiveMeeting(meeting_link: $meetingUrl, title: "Interview Meeting") {
        message
      }
    }
  `;

  const res = await fetch(FIREFLIES_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: { meetingUrl },
    }),
  });

  if (!res.ok) {
    throw new Error(`Fireflies API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (json.errors) {
    console.error("Fireflies GraphQL errors:", json.errors);
    throw new Error(json.errors[0]?.message || "Fireflies GraphQL error");
  }

  return true;
}
