"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, apiFetch } from "@/lib/client-api";
import type { AppSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={String(value)}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          onChange(Number.isFinite(parsed) ? parsed : min);
        }}
      />
    </Field>
  );
}

export function ConversationSettings({ settings }: { settings: AppSettings }) {
  const toast = useToast();
  const [values, setValues] = useState(settings);
  const [saving, setSaving] = useState(false);
  const dirty =
    values.maxHistoryMessages !== settings.maxHistoryMessages ||
    values.temperature !== settings.temperature ||
    values.maxTokens !== settings.maxTokens ||
    values.retryAttempts !== settings.retryAttempts ||
    values.providerTimeoutMs !== settings.providerTimeoutMs;

  async function save() {
    setSaving(true);
    try {
      const data = await apiFetch<{ settings: AppSettings }>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(values),
      });
      setValues(data.settings);
      toast.push("success", "Conversation settings saved");
    } catch (error) {
      toast.push(
        "error",
        "Could not save settings",
        error instanceof ApiError ? error.message : undefined,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <NumberField
          id="maxHistory"
          label="Max history messages"
          hint="How many past turns are sent to a provider as context."
          value={values.maxHistoryMessages}
          onChange={(maxHistoryMessages) => setValues((v) => ({ ...v, maxHistoryMessages }))}
          min={1}
          max={200}
        />
        <NumberField
          id="temperature"
          label="Temperature"
          hint="Lower is more predictable. A provider can override this."
          value={values.temperature}
          onChange={(temperature) => setValues((v) => ({ ...v, temperature }))}
          min={0}
          max={2}
          step={0.1}
        />
        <NumberField
          id="maxTokens"
          label="Max tokens"
          hint="Upper bound on a single reply."
          value={values.maxTokens}
          onChange={(maxTokens) => setValues((v) => ({ ...v, maxTokens }))}
          min={16}
          max={200000}
          step={16}
        />
        <NumberField
          id="retryAttempts"
          label="Retry attempts"
          hint="Extra tries on the same provider before falling back."
          value={values.retryAttempts}
          onChange={(retryAttempts) => setValues((v) => ({ ...v, retryAttempts }))}
          min={0}
          max={10}
        />
        <NumberField
          id="providerTimeout"
          label="Provider timeout (ms)"
          hint="A provider slower than this is treated as a timeout."
          value={values.providerTimeoutMs}
          onChange={(providerTimeoutMs) => setValues((v) => ({ ...v, providerTimeoutMs }))}
          min={1000}
          max={120000}
          step={1000}
        />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" onClick={save} disabled={!dirty || saving}>
          {saving ? <Loader2 size={12} className="animate-spin" /> : null}
          {saving ? "Saving…" : "Save conversation settings"}
        </Button>
        {dirty ? (
          <span className="text-[11.5px] text-[var(--fg-subtle)]">Unsaved changes</span>
        ) : (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[11.5px] text-[var(--success)]",
            )}
          >
            <Check size={12} strokeWidth={2.4} />
            Saved
          </span>
        )}
      </div>
    </div>
  );
}
