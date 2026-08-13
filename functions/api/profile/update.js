// functions/api/profile/update.js
import { getUserFromRequest, publicUser, json, errorJson } from "../../_lib/auth.js";

const VALID_AVATARS = ["avc1", "avc2", "avc3", "avc4", "avc5", "avc6"];

export async function onRequestPost({ request, env }) {
  const db = env.DB;
  const user = await getUserFromRequest(request, db);
  if (!user) {
    return errorJson("Not signed in.", 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid request body.");
  }

  const updates = [];
  const values = [];

  if (typeof body.username === "string") {
    const username = body.username.trim();
    if (username.length < 3 || username.length > 24) {
      return errorJson("Username must be 3-24 characters.");
    }
    if (username !== user.username) {
      const clash = await db
        .prepare("SELECT id FROM users WHERE username = ? AND id != ?")
        .bind(username, user.id)
        .first();
      if (clash) {
        return errorJson("That username is already taken.");
      }
    }
    updates.push("username = ?");
    values.push(username);
  }

  if (typeof body.avatar === "string") {
    if (!VALID_AVATARS.includes(body.avatar)) {
      return errorJson("Invalid avatar.");
    }
    updates.push("avatar = ?");
    values.push(body.avatar);
  }

  if (typeof body.isPrivate === "boolean") {
    updates.push("is_private = ?");
    values.push(body.isPrivate ? 1 : 0);
  }

  if (updates.length === 0) {
    return errorJson("Nothing to update.");
  }

  values.push(user.id);
  await db
    .prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const updated = await db
    .prepare("SELECT * FROM users WHERE id = ?")
    .bind(user.id)
    .first();

  return json({ user: publicUser(updated) });
}
