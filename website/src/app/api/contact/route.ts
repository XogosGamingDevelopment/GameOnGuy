import { NextRequest, NextResponse } from "next/server";

const MAILTRAP_API_TOKEN = process.env.MAILTRAP_API_TOKEN;
const TO_EMAIL = "Zack@gameonguy.com";
const FROM_EMAIL = "noreply@gameonguy.com";

interface ContactFormData {
  name: string;
  email: string;
  company?: string;
  inquiryType: string;
  message: string;
  subject?: string;
}

const inquiryTypeLabels: Record<string, string> = {
  general: "General Inquiry",
  sales: "Sales / Enterprise",
  support: "Technical Support",
  partnership: "Partnership",
  privacy: "Privacy Inquiry",
  legal: "Legal Inquiry",
  careers: "Career Interest",
};

export async function POST(request: NextRequest) {
  try {
    const data: ContactFormData = await request.json();

    // Validate required fields
    if (!data.name || !data.email || !data.message) {
      return NextResponse.json(
        { error: "Name, email, and message are required" },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 }
      );
    }

    // Build email subject
    const inquiryLabel = inquiryTypeLabels[data.inquiryType] || data.inquiryType || "Contact Form";
    const subject = data.subject || `[Game On Dude!] ${inquiryLabel} from ${data.name}`;

    // Build email body
    const htmlBody = `
      <h2>New Contact Form Submission</h2>
      <p><strong>From:</strong> ${data.name} (${data.email})</p>
      ${data.company ? `<p><strong>Company:</strong> ${data.company}</p>` : ""}
      <p><strong>Inquiry Type:</strong> ${inquiryLabel}</p>
      <hr />
      <h3>Message:</h3>
      <p>${data.message.replace(/\n/g, "<br />")}</p>
      <hr />
      <p style="color: #666; font-size: 12px;">
        Sent from the Game On Dude! website contact form
      </p>
    `;

    const textBody = `
New Contact Form Submission
============================

From: ${data.name} (${data.email})
${data.company ? `Company: ${data.company}` : ""}
Inquiry Type: ${inquiryLabel}

Message:
${data.message}

---
Sent from the Game On Dude! website contact form
    `.trim();

    // Check if Mailtrap is configured
    if (!MAILTRAP_API_TOKEN) {
      // Development mode: log the email instead of sending
      console.log("=== Contact Form Submission (Dev Mode) ===");
      console.log("To:", TO_EMAIL);
      console.log("Subject:", subject);
      console.log("Body:", textBody);
      console.log("==========================================");

      return NextResponse.json({
        success: true,
        message: "Message received (development mode)"
      });
    }

    // Send via Mailtrap API
    const response = await fetch("https://send.api.mailtrap.io/api/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MAILTRAP_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: {
          email: FROM_EMAIL,
          name: "Game On Dude!",
        },
        to: [
          {
            email: TO_EMAIL,
            name: "Zack Edwards",
          },
        ],
        reply_to: {
          email: data.email,
          name: data.name,
        },
        subject: subject,
        text: textBody,
        html: htmlBody,
        category: "Contact Form",
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Mailtrap API error:", errorData);
      return NextResponse.json(
        { error: "Failed to send message. Please try again later." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Message sent successfully"
    });

  } catch (error) {
    console.error("Contact form error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again later." },
      { status: 500 }
    );
  }
}
