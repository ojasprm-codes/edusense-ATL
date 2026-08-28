import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { enquiries } from "../../../db/schema";

const allowedInterests = new Set(["pilot", "demonstration", "partnership", "support", "technical", "billing", "other"]);

function clean(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

async function deliverEnquiry(enquiry: Record<string, string>) {
  const webhookUrl = env.APPS_SCRIPT_WEBHOOK_URL;
  const secret = env.APPS_SCRIPT_WEBHOOK_SECRET;
  if (!webhookUrl || !secret) return "pending_configuration";

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, enquiry }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Email webhook returned HTTP ${response.status}`);

  const result = (await response.json()) as { ok?: boolean; error?: string };
  if (!result.ok) throw new Error(result.error || "Email webhook rejected the enquiry");
  return "delivered";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = clean(body.name, 100);
    const school = clean(body.school, 160);
    const email = clean(body.email, 254).toLowerCase();
    const phone = clean(body.phone, 40);
    const interest = clean(body.interest, 30);
    const message = clean(body.message, 4000);
    const website = clean(body.website, 200);

    if (website) return Response.json({ received: true });
    if (name.length < 2 || school.length < 2 || message.length < 10) {
      return Response.json({ error: "Please complete your name, school and problem details." }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
    }
    if (!allowedInterests.has(interest)) {
      return Response.json({ error: "Please select a valid enquiry type." }, { status: 400 });
    }

    const reference = `EDU-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const db = getDb();
    await db.insert(enquiries).values({ reference, name, school, email, phone, interest, message });

    let deliveryStatus = "delivery_failed";
    try {
      deliveryStatus = await deliverEnquiry({ reference, name, school, email, phone, interest, message });
    } catch (error) {
      console.error("enquiry_email_failed", { reference, error });
    }
    await db.update(enquiries).set({ deliveryStatus }).where(eq(enquiries.reference, reference));

    return Response.json({ received: true, reference, notificationSent: deliveryStatus === "delivered" }, { status: 201 });
  } catch (error) {
    console.error("enquiry_submission_failed", error);
    return Response.json({ error: "We could not record your message. Please try again." }, { status: 500 });
  }
}
