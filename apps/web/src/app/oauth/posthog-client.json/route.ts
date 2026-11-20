import { clientMetadataDocument, oauthAvailability } from "@hostpog/posthog";
import { NextResponse } from "next/server";

/** OAuth Client ID Metadata Document fetched by PostHog (client_id = this URL). */
export async function GET() {
  const avail = oauthAvailability(process.env.HOSTPOG_PUBLIC_URL);
  if (!avail.available) return NextResponse.json({ error: avail.reason }, { status: 404 });
  return NextResponse.json(clientMetadataDocument(process.env.HOSTPOG_PUBLIC_URL!), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
