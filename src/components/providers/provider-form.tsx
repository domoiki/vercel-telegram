"use client";

import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ADMIN_KEY_EVENT, ApiError, apiFetch, getAdminKey, setAdminKey } from "@/lib/client-api";
import type { ProviderSummary } from "@/lib/providers/shared";
import { ADAPTER_IDS } from "@/lib/providers/shared";
import { useEffect, useState } from "react";

type AdapterMeta = { id: string; label: string; hint: string };

const DEFAULT_HEADERS = `{
  "HTTP-Referer": "https://your-domain.example",
  "X-Title": "Telegram AI Gateway"
}`;

export type ProviderFormValues = {
  name: string;
  description: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  adapter: string;
  temperature: string;
  maxTokens: string;
  timeoutMs: string;
  inputCostPerMillion: string;
  outputCostPerMillion: string;
  customHeaders: string;
  customBodyTemplate: string;
  customResponsePath: string;
};

export function emptyForm(): ProviderFormValues {
  return {
    name: "",
    description: "",
    baseUrl: "",
    apiKey: "",
    model: "",
    adapter: "openai-compatible",
    temperature: "",
    maxTokens: "",
    timeoutMs: "30000",
    inputCostPerMillion: "",
    outputCostPerMillion: "",
    customHeaders: "",
    customBodyTemplate: "",
    customResponsePath: "",
  };
}

export function formFromProvider(provider: ProviderSummary): ProviderFormValues {
  return {
    name: provider.name,
    description: provider.description ?? "",
    baseUrl: provider.baseUrl,
    apiKey: "",
    model: provider.model,
    adapter: provider.adapter,
    temperature: provider.temperature === null ? "" : String(provider.temperature),
    maxTokens: provider.maxTokens === null ? "" : String(provider.maxTokens),
    timeoutMs: String(provider.timeoutMs),
    inputCostPerMillion:
      provider.inputCostPerMillion === null ? "" : String(provider.inputCostPerMillion),
    outputCostPerMillion:
      provider.outputCostPerMillion === null ? "" : String(provider.outputCostPerMillion),
    customHeaders: "",
    customBodyTemplate: provider.customBodyTemplate ?? "",
    customResponsePath: provider.customResponsePath ?? "",
  };
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ProviderFormDialog({
  open,
  onClose,
  adapters,
  provider,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  adapters: AdapterMeta[];
  provider: ProviderSummary | null;
  onSaved: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [values, setValues] = useState<ProviderFormValues>(emptyForm);
  const [enabled, setEnabled] = useState(true);
  const [isPrimary, setIsPrimary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyPrompt, setKeyPrompt] = useState(false);
  const [adminKey, setAdminKeyValue] = useState("");

  useEffect(() => {
    if (!open) return;
    setError(null);
    setKeyPrompt(false);
    if (provider) {
      setValues(formFromProvider(provider));
      setEnabled(provider.enabled);
      setIsPrimary(provider.isPrimary);
    } else {
      setValues(emptyForm());
      setEnabled(true);
      setIsPrimary(false);
    }
  }, [open, provider]);

  const set = <K extends keyof ProviderFormValues>(key: K, value: ProviderFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const adapter = adapters.find((a) => a.id === values.adapter);
  const isCustom = values.adapter === "custom-http";

  async function save() {
    setSaving(true);
    setError(null);
    try {
      let customHeaders: Record<string, string> | null = null;
      if (values.customHeaders.trim()) {
        const parsed: unknown = JSON.parse(values.customHeaders);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Custom headers must be a JSON object of string values.");
        }
        customHeaders = parsed as Record<string, string>;
      }

      const payload = {
        name: values.name.trim(),
        description: values.description.trim() || null,
        baseUrl: values.baseUrl.trim(),
        model: values.model.trim(),
        adapter: values.adapter,
        temperature: numberOrNull(values.temperature),
        maxTokens: numberOrNull(values.maxTokens),
        timeoutMs: Number(values.timeoutMs) || 30000,
        inputCostPerMillion: numberOrNull(values.inputCostPerMillion),
        outputCostPerMillion: numberOrNull(values.outputCostPerMillion),
        customHeaders,
        customBodyTemplate: values.customBodyTemplate.trim() || null,
        customResponsePath: values.customResponsePath.trim() || null,
        enabled,
        isPrimary,
        ...(values.apiKey.trim() ? { apiKey: values.apiKey.trim() } : {}),
      };

      if (provider) {
        await apiFetch(`/api/providers/${provider.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        toast.push("success", "Provider updated", provider.name);
      } else {
        await apiFetch("/api/providers", { method: "POST", body: JSON.stringify(payload) });
        toast.push("success", "Provider added", values.name);
      }
      await onSaved();
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setKeyPrompt(true);
        setError("This deployment requires an admin key for changes.");
      } else if (caught instanceof ApiError) {
        setError(caught.message);
      } else if (caught instanceof SyntaxError) {
        setError("One of the JSON fields is not valid JSON.");
      } else {
        setError(caught instanceof Error ? caught.message : "Could not save the provider.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={provider ? `Edit ${provider.name}` : "Add an AI provider"}
      description={
        provider
          ? "Changes take effect on the next message. The API key is only replaced if you type a new one."
          : "The provider count is unlimited. Add as many as you need and arrange the fallback order afterwards."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : provider ? "Save changes" : "Add provider"}
          </Button>
        </>
      }
    >
      {keyPrompt ? (
        <div className="mb-4 rounded-[var(--radius-control)] border border-[var(--warning)]/35 bg-[var(--warning-wash)] p-3">
          <p className="text-[12.5px] leading-[17px] text-[var(--fg)]">
            This deployment sets <code className="font-[var(--font-mono)]">ADMIN_API_KEY</code>. Enter
            it to make changes. It is kept in this tab only.
          </p>
          <div className="mt-2.5 flex gap-2">
            <Input
              type="password"
              value={adminKey}
              autoComplete="off"
              onChange={(event) => setAdminKeyValue(event.target.value)}
              placeholder="Admin key"
              aria-label="Admin key"
            />
            <Button
              onClick={() => {
                setAdminKey(adminKey);
                setKeyPrompt(false);
                setError(null);
                toast.push("info", "Admin key stored for this tab");
              }}
            >
              Use key
            </Button>
          </div>
        </div>
      ) : null}

      {error && !keyPrompt ? (
        <p
          role="alert"
          className="mb-4 rounded-[var(--radius-control)] border border-[var(--error)]/35 bg-[var(--error-wash)] px-3 py-2 text-[12.5px] leading-[17px] text-[var(--error)]"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required htmlFor="p-name">
          <Input
            id="p-name"
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="OpenRouter"
            autoComplete="off"
          />
        </Field>

        <Field
          label="API format"
          required
          htmlFor="p-adapter"
          hint={adapter?.hint}
        >
          <Select
            id="p-adapter"
            value={values.adapter}
            onChange={(e) => set("adapter", e.target.value)}
          >
            {adapters.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>

        <div className="sm:col-span-2">
          <Field label="Description" htmlFor="p-desc" hint="Only you see this. Useful when you run several.">
            <Input
              id="p-desc"
              value={values.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Cheap fallback for rate limits"
              autoComplete="off"
            />
          </Field>
        </div>

        <Field
          label={isCustom ? "Endpoint URL" : "API endpoint"}
          required
          htmlFor="p-url"
          hint={isCustom ? "The full URL, including the path." : "Base URL. The adapter appends its own path."}
        >
          <Input
            id="p-url"
            value={values.baseUrl}
            onChange={(e) => set("baseUrl", e.target.value)}
            placeholder={
              isCustom ? "https://api.example.com/v1/chat" : "https://api.openai.com/v1"
            }
            autoComplete="off"
            spellCheck={false}
          />
        </Field>

        <Field label="Model" required htmlFor="p-model">
          <Input
            id="p-model"
            value={values.model}
            onChange={(e) => set("model", e.target.value)}
            placeholder="gpt-4o-mini"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field
            label="API key"
            htmlFor="p-key"
            hint={
              provider?.hasApiKey
                ? `Stored as ${provider.apiKeyMask}. Leave blank to keep it.`
                : "Encrypted before it reaches the database and never returned to the browser."
            }
          >
            <Input
              id="p-key"
              type="password"
              value={values.apiKey}
              onChange={(e) => set("apiKey", e.target.value)}
              placeholder={provider?.hasApiKey ? "••••••••••••" : "sk-…"}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        </div>

        <Field label="Temperature" htmlFor="p-temp" hint="Leave blank to use the global default.">
          <Input
            id="p-temp"
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={values.temperature}
            onChange={(e) => set("temperature", e.target.value)}
            placeholder="0.7"
          />
        </Field>

        <Field label="Max tokens" htmlFor="p-max" hint="Leave blank to use the global default.">
          <Input
            id="p-max"
            type="number"
            min="16"
            max="200000"
            value={values.maxTokens}
            onChange={(e) => set("maxTokens", e.target.value)}
            placeholder="4096"
          />
        </Field>

        <Field label="Timeout (ms)" htmlFor="p-timeout" hint="A slower provider is retried before falling back.">
          <Input
            id="p-timeout"
            type="number"
            min="1000"
            max="120000"
            step="1000"
            value={values.timeoutMs}
            onChange={(e) => set("timeoutMs", e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Cost / 1M in" htmlFor="p-cost-in" hint="Optional">
            <Input
              id="p-cost-in"
              type="number"
              step="0.01"
              min="0"
              value={values.inputCostPerMillion}
              onChange={(e) => set("inputCostPerMillion", e.target.value)}
              placeholder="0.15"
            />
          </Field>
          <Field label="Cost / 1M out" htmlFor="p-cost-out" hint="Optional">
            <Input
              id="p-cost-out"
              type="number"
              step="0.01"
              min="0"
              value={values.outputCostPerMillion}
              onChange={(e) => set("outputCostPerMillion", e.target.value)}
              placeholder="0.60"
            />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field
            label="Custom headers"
            htmlFor="p-headers"
            hint="Sent with every request. Used for things like OpenRouter attribution."
          >
            <Textarea
              id="p-headers"
              rows={4}
              value={values.customHeaders}
              onChange={(e) => set("customHeaders", e.target.value)}
              placeholder={DEFAULT_HEADERS}
              spellCheck={false}
              className="font-[var(--font-mono)] text-[11.5px]"
            />
          </Field>
          {provider?.hasCustomHeaders ? (
            <p className="mt-1 text-[11.5px] text-[var(--fg-subtle)]">
              {provider.customHeaderNames.length} header
              {provider.customHeaderNames.length === 1 ? "" : "s"} stored. Paste the current values here
              to replace them.
            </p>
          ) : null}
        </div>

        {isCustom ? (
          <>
            <div className="sm:col-span-2">
              <Field
                label="Request body template"
                htmlFor="p-body"
                hint="Placeholders: {{messages}}, {{prompt}}, {{system}}, {{model}}, {{temperature}}, {{maxTokens}}"
              >
                <Textarea
                  id="p-body"
                  rows={5}
                  value={values.customBodyTemplate}
                  onChange={(e) => set("customBodyTemplate", e.target.value)}
                  placeholder='{"model":"{{model}}","input":"{{prompt}}"}'
                  spellCheck={false}
                  className="font-[var(--font-mono)] text-[11.5px]"
                />
              </Field>
            </div>
            <Field
              label="Reply text path"
              htmlFor="p-path"
              hint="Dot path into the JSON response."
              className="sm:col-span-2"
            >
              <Input
                id="p-path"
                value={values.customResponsePath}
                onChange={(e) => set("customResponsePath", e.target.value)}
                placeholder="choices.0.message.content"
                spellCheck={false}
                className="font-[var(--font-mono)] text-[11.5px]"
              />
            </Field>
          </>
        ) : null}

        <div className="sm:col-span-2">
          <div className="divide-y divide-[var(--line-faint)] rounded-[var(--radius-control)] border border-[var(--line)] px-3">
            <Switch
              label="Enabled"
              description="Disabled providers stay configured but are skipped by the router."
              checked={enabled}
              onChange={setEnabled}
            />
            <Switch
              label="Primary provider"
              description="Used first. Exactly one enabled provider is primary at a time."
              checked={isPrimary}
              onChange={setIsPrimary}
              disabled={!enabled}
            />
          </div>
        </div>
      </div>
    </Dialog>
  );
}

export function useAdminKeyListener(onPrompt: () => void) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => onPrompt();
    window.addEventListener(ADMIN_KEY_EVENT, handler);
    return () => window.removeEventListener(ADMIN_KEY_EVENT, handler);
  }, [onPrompt]);
}

export { ADAPTER_IDS, getAdminKey };
