import { OAuth2Client } from "google-auth-library";

export function googleVerifier(audience) {
  const client = new OAuth2Client();
  return async (idToken) => {
    const ticket = await client.verifyIdToken({ idToken, audience });
    return Boolean(ticket.getPayload()?.sub);
  };
}
