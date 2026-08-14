// functions/_lib/email.js
// Shared helper for sending transactional email via Resend (free plan).
//
// RESEND_API_KEY must be set in Cloudflare Pages → Settings → Environment
// variables as a secret (Production AND Preview). Never hardcode it here or
// commit it to git.
//
// Optional: RESEND_FROM_EMAIL to override the default "from" address once
// you've verified a domain on Resend (e.g. "earnbangla <no-reply@earn-bangla.com>").

export async function sendEmail(env, { to, subject, html }) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL || "earnbangla <support@earn-bangla.com>",
      to,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Resend API error (${res.status}): ${errBody}`);
  }

  return res.json();
}

// Simple OTP email template — inline CSS only (email clients don't reliably
// support <style> tags), loosely matching earnbangla's orange/dark theme.
// Subject line is kept plain on purpose (see TASK-auth-fixes.md §6) so it's
// less likely to be flagged as spam.
export function otpEmailHtml(otp) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#0A0A0F;padding:32px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:420px;margin:0 auto;background:#14141F;border-radius:16px;overflow:hidden;">
    <tr>
      <td style="padding:28px 28px 8px;text-align:center;">
        <div style="font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:20px;color:#F4F4F8;">
          earn<span style="color:#FF7A1A;">bangla</span>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 28px 4px;text-align:center;">
        <p style="color:#9A9AAD;font-size:14px;margin:0 0 20px;">Use this code to reset your password. It expires in 10 minutes.</p>
        <div style="display:inline-block;background:#0A0A0F;border:1px solid #232333;border-radius:12px;padding:16px 28px;">
          <span style="font-family:Arial,Helvetica,sans-serif;font-size:32px;font-weight:800;letter-spacing:8px;color:#FF7A1A;">${otp}</span>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 28px 28px;text-align:center;">
        <p style="color:#67677A;font-size:12px;margin:0;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
      </td>
    </tr>
  </table>
</div>`;
}
