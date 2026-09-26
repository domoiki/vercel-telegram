"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CircleSlash,
  Link2,
  Loader2,
  PlugZap,
  RefreshCw,
  Save,
} from "lucide-react";

import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Switch } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, apiFetch } from "@/lib/client-api";
import { formatDateTime, relativeTime } from "@/lib/format";

export type TelegramConfigView = {
  hasBotToken: boolean;
  botTokenMask: string | null;
  chatId1: string;
  chatId2: string;
  chatId3: string;
  replyToUnauthorized: boolean;
  botUsername: string | null;
  botDisplayName: string | null;
  webhookUrl: string | null;
  webhookPendingCount: number | null;
  webhookLastError: string | null;
  lastCheckedAt: Date | null;
  updatedAt: Date;
};

type WebhookStatus = {
  url: string;
  pendingUpdateCount: number;
  lastError: string | null;
  lastErrorDate: number | null;
  ipAddress: string | null;
};

export function TelegramSettings({ initial }: { initial: TelegramConfigView }) {
  const router = useRouter();
  const toast = useToast();

  const [token, setToken] = useState("");
  const [chatIds, setChatIds] = useState([initial.chatId1, initial.chatId2, initial.chatId3]);
  const [replyToUnauthorized, setReplyToUnauthorized] = useState(initial.replyToUnauthorized);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [webhookBusy, setWebhookBusy] = useState<"register" | "remove" | "status" | null>(null);
  const [webhook, setWebhook] = useState<WebhookStatus | null>(null);

  const savedSlots = [initial.chatId1, initial.chatId2, initial.chatId3].join("|");
  const currentSlots = chatIds.join("|");
  const dirty =
    token.trim().length > 0 ||
    currentSlots !== savedSlots ||
    replyToUnauthorized !== initial.replyToUnauthorized;

  const filledSlots = chatIds.filter((v) => v.trim().length > 0).length;

  async function save() {
    setSaving(true);
    try {
      await apiFetch("/api/telegram/config", {
        method: "PATCH",
        body: JSON.stringify({
          ...(token.trim() ? { botToken: token.trim() } : {}),
          chatId1: chatIds[0] ?? "",
          chatId2: chatIds[1] ?? "",
          chatId3: chatIds[2] ?? "",
          replyToUnauthorized,
        }),
      });
      setToken("");
      toast.push("success", "Telegram settings saved");
      router.refresh();
    } catch (error) {
      toast.push(
        "error",
        "Could not save Telegram settings",
        error instanceof ApiError ? error.message : undefined,
      );
    } finally {
      setSaving(false);
    }
  }

  async function testBot() {
    setTesting(true);
    try {
      await apiFetch<{ ok: boolean; username: string }>("/api/telegram/test", { method: "POST" });
      toast.push("success", "Bot token is valid", "Telegram accepted the credentials");
      router.refresh();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Telegram rejected the token";
      toast.push("error", "Bot token rejected", message);
    } finally {
      setTesting(false);
    }
  }

  async function registerWebhook() {
    setWebhookBusy("register");
    try {
      const data = await apiFetch<{ registered: boolean; url: string }>(
        "/api/telegram/webhook/manage",
        { method: "POST" },
      );
      toast.push("success", "Webhook registered", data.url);
      router.refresh();
      await refreshStatus();
    } catch (error) {
      toast.push(
        "error",
        "Could not register the webhook",
        error instanceof ApiError ? error.message : undefined,
      );
    } finally {
      setWebhookBusy(null);
    }
  }

  async function removeWebhook() {
    setWebhookBusy("remove");
    try {
      await apiFetch("/api/telegram/webhook/manage", { method: "DELETE" });
      toast.push("success", "Webhook removed", "Pending updates were dropped");
      setWebhook(null);
      router.refresh();
    } catch (error) {
      toast.push(
        "error",
        "Could not remove the webhook",
        error instanceof ApiError ? error.message : undefined,
      );
    } finally {
      setWebhookBusy(null);
    }
  }

  async function refreshStatus() {
    setWebhookBusy("status");
    try {
      const data = await apiFetch<WebhookStatus>("/api/telegram/webhook/manage");
      setWebhook(data);
    } catch (error) {
      toast.push(
        "error",
        "Could not read webhook status",
        error instanceof ApiError ? error.message : undefined,
      );
    } finally {
      setWebhookBusy(null);
    }
  }

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <Field
          label="Bot token"
          hint={
            initial.hasBotToken
              ? `Stored as ${initial.botTokenMask}. Leave blank to keep it.`
              : "Paste the token from @BotFather. It is encrypted before it is stored."
          }
        >
          <Input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={initial.hasBotToken ? "••••••••••••" : "123456789:AA…"}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>

        <div>
          <p className="mb-1.5 text-[12px] leading-4 font-[550] text-[var(--fg)]">
            Allowed chat ids
            <span className="ml-1.5 font-[var(--font-mono)] text-[11px] font-normal text-[var(--fg-subtle)]">
              {filledSlots}/3 filled
            </span>
          </p>
          <p className="mb-2.5 text-[11.5px] leading-4 text-[var(--fg-subtle)]">
            Only these chats can reach the AI. Message someone on Telegram, or open{" "}
            <code className="font-[var(--font-mono)]">api.telegram.org/bot&lt;token&gt;/getUpdates</code>{" "}
            to read their numeric id.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {chatIds.map((value, index) => (
              <Input
                key={index}
                aria-label={`Chat id ${index + 1}`}
                placeholder={index === 0 ? "e.g. 123456789" : "optional"}
                value={value}
                inputMode="numeric"
                onChange={(event) => {
                  const next = [...chatIds];
                  next[index] = event.target.value.replace(/[^\d-]/g, "");
                  setChatIds(next);
                }}
                className="font-[var(--font-mono)] text-[12px]"
              />
            ))}
          </div>
        </div>

        <div className="rounded-[var(--radius-control)] border border-[var(--line)] px-3">
          <Switch
            label="Reply to unknown chats"
            description="Send a short notice when a chat outside the allowlist writes. The message never mentions providers or credentials."
            checked={replyToUnauthorized}
            onChange={setReplyToUnauthorized}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={save} disabled={!dirty || saving}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} strokeWidth={2} />}
            {saving ? "Saving…" : "Save Telegram settings"}
          </Button>
          <Button onClick={testBot} disabled={testing || !initial.hasBotToken}>
            {testing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <PlugZap size={12} strokeWidth={2} />
            )}
            {testing ? "Checking…" : "Test bot connection"}
          </Button>
        </div>
        {!initial.hasBotToken ? (
          <p className="text-[11.5px] text-[var(--fg-subtle)]">
            Save a token first, then test the connection.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--surface-2)] p-4">
        <div>
          <p className="text-[12.5px] font-[600] text-[var(--fg)]">Webhook</p>
          <p className="mt-0.5 text-[12px] leading-[16px] text-[var(--fg-muted)]">
            Telegram delivers updates by webhook. The URL is this deployment&apos;s{" "}
            <code className="font-[var(--font-mono)] text-[11.5px]">/api/telegram/webhook</code> route.
          </p>
        </div>

        <dl className="flex flex-col gap-1.5">
          <Row label="Bot">
            {initial.botUsername ? (
              <span className="inline-flex items-center gap-1.5">
                <StatusDot tone="success" />
                <a
                  href={`https://t.me/${initial.botUsername}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-[var(--font-mono)] text-[11.5px] text-[var(--accent)] hover:underline"
                >
                  @{initial.botUsername}
                </a>
              </span>
            ) : (
              <span className="text-[var(--fg-subtle)]">Not verified yet</span>
            )}
          </Row>
          <Row label="Registered URL">
            <span className="font-[var(--font-mono)] text-[11px] break-all">
              {initial.webhookUrl ?? "—"}
            </span>
          </Row>
          <Row label="Pending updates">
            {initial.webhookPendingCount === null ? (
              <span className="text-[var(--fg-subtle)]">—</span>
            ) : (
              <span className="tnum font-[var(--font-mono)] text-[11.5px]">
                {initial.webhookPendingCount}
              </span>
            )}
          </Row>
          <Row label="Last checked">
            <span className="text-[11.5px]">
              {initial.lastCheckedAt ? (
                <>
                  {relativeTime(initial.lastCheckedAt)}{" "}
                  <span className="text-[var(--fg-subtle)]">
                    ({formatDateTime(initial.lastCheckedAt)})
                  </span>
                </>
              ) : (
                <span className="text-[var(--fg-subtle)]">Never</span>
              )}
            </span>
          </Row>
        </dl>

        {initial.webhookLastError || webhook?.lastError ? (
          <div className="rounded-[var(--radius-control)] border border-[var(--error)]/30 bg-[var(--error-wash)] px-2.5 py-2">
            <p className="text-[11.5px] leading-4 font-[550] text-[var(--error)]">
              Telegram reported an error
            </p>
            <p className="mt-0.5 font-[var(--font-mono)] text-[11px] leading-[15px] break-words text-[var(--error)]">
              {webhook?.lastError ?? initial.webhookLastError}
            </p>
          </div>
        ) : null}

        {webhook?.url && webhook.url !== initial.webhookUrl ? (
          <Badge tone="info" dot>
            Telegram reports a different URL
          </Badge>
        ) : null}

        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Button onClick={registerWebhook} disabled={!initial.hasBotToken || webhookBusy !== null}>
            {webhookBusy === "register" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Link2 size={12} strokeWidth={2} />
            )}
            Register webhook
          </Button>
          <Button
            onClick={refreshStatus}
            disabled={!initial.hasBotToken || webhookBusy !== null}
            variant="ghost"
          >
            {webhookBusy === "status" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} strokeWidth={2} />
            )}
            Check status
          </Button>
          <Button
            onClick={removeWebhook}
            disabled={!initial.webhookUrl || webhookBusy !== null}
            variant="danger"
          >
            {webhookBusy === "remove" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <CircleSlash size={12} strokeWidth={2} />
            )}
            Remove
          </Button>
        </div>

        {initial.webhookUrl ? (
          <p className="flex items-start gap-1.5 text-[11.5px] leading-4 text-[var(--fg-subtle)]">
            <Check size={11} strokeWidth={2.4} className="mt-0.5 shrink-0 text-[var(--success)]" />
            The gateway is live at this URL. Send a message from an allowlisted chat to confirm.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--line-faint)] pb-1.5 last:border-0">
      <dt className="shrink-0 text-[12px] text-[var(--fg-muted)]">{label}</dt>
      <dd className="min-w-0 text-right text-[var(--fg)]">{children}</dd>
    </div>
  );
}
