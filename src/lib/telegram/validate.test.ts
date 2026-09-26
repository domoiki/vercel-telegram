import { describe, expect, it } from "vitest";

import { isChatAllowed, parseTelegramUpdate, verifySecretToken } from "./validate";

/** Minimal, realistic Telegram payload. */
function update(overrides: Record<string, unknown> = {}) {
  return {
    update_id: 1001,
    message: {
      message_id: 42,
      date: 1_700_000_000,
      chat: { id: 555_000_111, type: "private" },
      from: { id: 900, is_bot: false, first_name: "Dana", username: "dana" },
      text: "hello there",
    },
    ...overrides,
  };
}

describe("parseTelegramUpdate", () => {
  it("normalises a private text message", () => {
    const result = parseTelegramUpdate(update());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.source).toBe("message");
    expect(result.message).toMatchObject({
      updateId: 1001,
      messageId: 42,
      chatId: "555000111",
      chatType: "private",
      userId: "900",
      username: "dana",
      firstName: "Dana",
      lastName: null,
      text: "hello there",
      isCommand: false,
      commandName: null,
    });
    expect(result.message.date?.toISOString()).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("rejects a body that is not an object", () => {
    for (const body of [null, undefined, "text", 42, true]) {
      const result = parseTelegramUpdate(body);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/not an object/i);
    }
  });

  it("rejects an array body as a missing update rather than crashing", () => {
    const result = parseTelegramUpdate([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/update_id/i);
  });

  it("rejects an update with no usable update_id", () => {
    for (const updateId of [undefined, null, "1001", Number.NaN, {}]) {
      const result = parseTelegramUpdate(update({ update_id: updateId }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/update_id/i);
    }
  });

  it("rejects an update carrying no message object", () => {
    const result = parseTelegramUpdate({ update_id: 7 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no message/i);
  });

  it("rejects a message with an unusable chat id", () => {
    for (const chatId of [undefined, null, {}, "not-a-number", true]) {
      const body = update();
      (body.message as { chat: { id: unknown } }).chat.id = chatId;
      const result = parseTelegramUpdate(body);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/chat id/i);
    }
  });

  it("accepts a negative chat id, as used by group chats", () => {
    const body = update();
    (body.message as { chat: { id: unknown } }).chat.id = -100_188_744_2109;
    const result = parseTelegramUpdate(body);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message.chatId).toBe("-1001887442109");
  });

  it("rejects a message with no message_id", () => {
    const body = update();
    delete (body.message as { message_id?: number }).message_id;
    const result = parseTelegramUpdate(body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/message_id/i);
  });

  it("reads edited_message and channel_post from the same shape", () => {
    const edited = parseTelegramUpdate({
      update_id: 2,
      edited_message: update().message,
    });
    expect(edited.ok).toBe(true);
    if (edited.ok) expect(edited.source).toBe("edited_message");

    const post = parseTelegramUpdate({
      update_id: 3,
      channel_post: { ...update().message, chat: { id: -100, type: "channel" } },
    });
    expect(post.ok).toBe(true);
    if (post.ok) {
      expect(post.source).toBe("channel_post");
      expect(post.message.chatType).toBe("channel");
    }
  });

  it("falls back to the caption when there is no text", () => {
    const body = update();
    const message = body.message as Record<string, unknown>;
    delete message.text;
    message.caption = "a photo caption";
    const result = parseTelegramUpdate(body);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message.text).toBe("a photo caption");
  });

  it("treats a media-only message as valid with empty text", () => {
    const body = update();
    const message = body.message as Record<string, unknown>;
    delete message.text;
    const result = parseTelegramUpdate(body);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message.text).toBe("");
  });

  it("extracts the command name, ignoring the @bot suffix", () => {
    const result = parseTelegramUpdate(
      update({ message: { ...update().message, text: "/reset@MyBot now" } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.isCommand).toBe(true);
      expect(result.message.commandName).toBe("reset");
    }
  });

  it("defaults a missing chat type to private", () => {
    const body = update();
    (body.message as { chat: Record<string, unknown> }).chat = { id: 555000111 };
    const result = parseTelegramUpdate(body);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message.chatType).toBe("private");
  });

  it("tolerates a missing from block", () => {
    const body = update();
    delete (body.message as { from?: unknown }).from;
    const result = parseTelegramUpdate(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.userId).toBeNull();
      expect(result.message.username).toBeNull();
    }
  });
});

describe("isChatAllowed", () => {
  const slots = { chatId1: "555000111", chatId2: "-1001887442109", chatId3: null };

  it("allows a chat that matches any configured slot", () => {
    expect(isChatAllowed("555000111", slots).allowed).toBe(true);
    expect(isChatAllowed("-1001887442109", slots).allowed).toBe(true);
  });

  it("rejects a chat that is not on the list", () => {
    const result = isChatAllowed("777000999", slots);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toMatch(/not in the allowlist/i);
  });

  it("fails closed when no chat id is configured", () => {
    const result = isChatAllowed("555000111", {
      chatId1: null,
      chatId2: null,
      chatId3: null,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toMatch(/no chat ids configured/i);
  });

  it("ignores whitespace in a configured slot", () => {
    expect(
      isChatAllowed("555000111", { ...slots, chatId1: "  555000111  " }).allowed,
    ).toBe(true);
  });

  it("compares ids exactly, not as a prefix", () => {
    expect(isChatAllowed("55500011", slots).allowed).toBe(false);
    expect(isChatAllowed("5550001111", slots).allowed).toBe(false);
  });
});

describe("verifySecretToken", () => {
  it("passes everything when no secret is configured", () => {
    expect(verifySecretToken("anything", null)).toBe(true);
    expect(verifySecretToken(null, undefined)).toBe(true);
  });

  it("requires an exact match when a secret is configured", () => {
    expect(verifySecretToken("s3cret", "s3cret")).toBe(true);
    expect(verifySecretToken("s3cre", "s3cret")).toBe(false);
    expect(verifySecretToken("s3crett", "s3cret")).toBe(false);
    expect(verifySecretToken("S3CRET", "s3cret")).toBe(false);
    expect(verifySecretToken(null, "s3cret")).toBe(false);
  });
});
