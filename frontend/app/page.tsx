// Solution by Mike Chen <mike2025@rocketship.com> created using Claude Fable 5 AI
// for the U.S. Department of Treasury as part of the candidate interview process.

"use client";

import { FormEvent, useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

interface RequirementResult {
  requirement: string;
  present: boolean;
  foundOn: string | null;
  extractedText: string | null;
  issues: string[];
  confidence: string;
  status: "PASS" | "WARN" | "FAIL";
}

interface ConsistencyFinding {
  field: string;
  declaredValue: string | null;
  labelValue: string | null;
  consistent: boolean;
  note: string | null;
}

interface ReviewResponse {
  checks: RequirementResult[];
  applicationConsistency: ConsistencyFinding[];
  overallSummary: string;
}

// Label-checkable fields from the COLA application form (TTB F 5100.31)
interface AppData {
  applicantNameAddress: string;
  brandName: string;
  classType: string;
  netContents: string;
  alcoholContent: string;
}

const APP_FIELDS: { key: keyof AppData; label: string }[] = [
  { key: "applicantNameAddress", label: "Applicant name & address" },
  { key: "brandName", label: "Brand name" },
  { key: "classType", label: "Class / type designation" },
  { key: "netContents", label: "Net contents" },
  { key: "alcoholContent", label: "Alcohol content" },
];

const APP_FIELD_LABELS: Record<string, string> = Object.fromEntries(
  APP_FIELDS.map((f) => [f.key, f.label]),
);

function emptyAppData(): AppData {
  return {
    applicantNameAddress: "",
    brandName: "",
    classType: "",
    netContents: "",
    alcoholContent: "",
  };
}

interface LabelPair {
  front: File | null;
  back: File | null;
  commodity: string;
  imported: boolean;
  app: AppData;
}

interface BatchItem {
  name: string;
  status: "pending" | "done" | "error";
  data?: ReviewResponse;
  error?: string;
}

// Downscale large photos client-side before upload: label text stays readable
// at 1600px on the long edge, uploads stay well under the Claude API's 5 MB
// image limit, and smaller images process faster.
async function downscaleImage(file: File): Promise<File> {
  const MAX_EDGE = 1600;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = MAX_EDGE / Math.max(bitmap.width, bitmap.height);
    if (scale >= 1) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", {
      type: "image/jpeg",
    });
  } catch {
    // Fall back to the original file if the browser can't decode it
    return file;
  }
}

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("haiku");
  const [pairs, setPairs] = useState<LabelPair[]>([
    {
      front: null,
      back: null,
      commodity: "distilled spirits",
      imported: false,
      app: emptyAppData(),
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchItem[]>([]);

  function updatePair<K extends keyof LabelPair>(
    index: number,
    field: K,
    value: LabelPair[K],
  ) {
    setPairs((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)),
    );
  }

  function updateAppData(index: number, field: keyof AppData, value: string) {
    setPairs((prev) =>
      prev.map((p, i) =>
        i === index ? { ...p, app: { ...p.app, [field]: value } } : p,
      ),
    );
  }

  function addPair() {
    // New labels inherit the previous label's commodity and import status,
    // so homogeneous batches (the common case) need no extra clicks.
    setPairs((prev) => {
      const last = prev[prev.length - 1];
      return [
        ...prev,
        {
          front: null,
          back: null,
          commodity: last?.commodity ?? "distilled spirits",
          imported: last?.imported ?? false,
          app: emptyAppData(),
        },
      ];
    });
  }

  function removePair(index: number) {
    setPairs((prev) => prev.filter((_, i) => i !== index));
  }

  async function reviewOne(pair: LabelPair): Promise<ReviewResponse> {
    const [frontScaled, backScaled] = await Promise.all([
      downscaleImage(pair.front!),
      pair.back ? downscaleImage(pair.back) : Promise.resolve(null),
    ]);

    const form = new FormData();
    form.append("front", frontScaled);
    if (backScaled) {
      form.append("back", backScaled);
    }
    form.append("commodity", pair.commodity);
    form.append("imported", String(pair.imported));
    form.append("model", model);
    for (const { key } of APP_FIELDS) {
      if (pair.app[key].trim()) {
        form.append(key, pair.app[key].trim());
      }
    }

    const headers: Record<string, string> = {};
    if (apiKey.trim()) {
      headers["X-Anthropic-Api-Key"] = apiKey.trim();
    }

    const res = await fetch(`${API_BASE}/api/review`, {
      method: "POST",
      headers,
      body: form,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error ?? `Request failed with status ${res.status}`);
    }

    return (await res.json()) as ReviewResponse;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pairs.some((p) => !p.front)) {
      setError("Please provide a front image for every label.");
      return;
    }

    setLoading(true);
    setError(null);
    setBatch(
      pairs.map((p, i) => ({
        name: p.back
          ? `Label ${i + 1} — front: ${p.front!.name}, back: ${p.back.name}`
          : `Label ${i + 1} — ${p.front!.name}`,
        status: "pending" as const,
      })),
    );

    // All labels are reviewed in parallel; each row updates as it finishes.
    await Promise.all(
      pairs.map((pair, i) =>
        reviewOne(pair).then(
          (data) =>
            setBatch((prev) =>
              prev.map((r, j) => (j === i ? { ...r, status: "done", data } : r)),
            ),
          (err) =>
            setBatch((prev) =>
              prev.map((r, j) =>
                j === i
                  ? {
                      ...r,
                      status: "error",
                      error: err instanceof Error ? err.message : String(err),
                    }
                  : r,
              ),
            ),
        ),
      ),
    );

    setLoading(false);
  }

  const doneCount = batch.filter((b) => b.status !== "pending").length;

  return (
    <main>
      <h1>AI COLA App</h1>
      <p className="subtitle">
        TTB COLA label pre-screener — checks front (and optional back) label
        images against the 8 mandatory requirements.
      </p>
      <p className="attribution">
        Solution by <strong>Mike Chen</strong>{" "}
        <a href="mailto:mike2025@rocketship.com">
          &lt;mike2025@rocketship.com&gt;
        </a>{" "}
        created using Claude Fable 5 AI for the U.S. Department of Treasury as
        part of the candidate interview process.
      </p>

      <form onSubmit={onSubmit}>
        {pairs.map((pair, i) => (
          <fieldset className="label-pair" key={i}>
            <legend>
              Label {i + 1}
              {pairs.length > 1 && (
                <button
                  type="button"
                  className="remove-pair"
                  onClick={() => removePair(i)}
                >
                  Remove
                </button>
              )}
            </legend>

            <label>
              Front label image
              <span className="hint">
                Only JPEG, PNG, GIF, and WebP files are allowed.
              </span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={(e) => updatePair(i, "front", e.target.files?.[0] ?? null)}
                required
              />
            </label>

            <label>
              Back label image (optional)
              <span className="hint">
                Leave empty for single-label products. Only JPEG, PNG, GIF,
                and WebP files are allowed.
              </span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={(e) => updatePair(i, "back", e.target.files?.[0] ?? null)}
              />
            </label>

            <label>
              Commodity
              <select
                value={pair.commodity}
                onChange={(e) => updatePair(i, "commodity", e.target.value)}
              >
                <option value="wine">Wine</option>
                <option value="distilled spirits">Distilled spirits</option>
                <option value="malt beverage">Malt beverage</option>
              </select>
            </label>

            <div className="checkbox-row">
              <input
                id={`imported-${i}`}
                type="checkbox"
                checked={pair.imported}
                onChange={(e) => updatePair(i, "imported", e.target.checked)}
              />
              <label htmlFor={`imported-${i}`}>Imported product</label>
            </div>

            <details className="advanced">
              <summary>Application data (TTB F 5100.31) — optional</summary>
              <p className="hint">
                Enter values declared on the COLA application and the review
                will cross-check the labels against them, like a TTB examiner
                verifying form-to-label consistency.
              </p>
              {APP_FIELDS.map(({ key, label }) => (
                <label key={key}>
                  {label}
                  <input
                    type="text"
                    value={pair.app[key]}
                    onChange={(e) => updateAppData(i, key, e.target.value)}
                  />
                </label>
              ))}
            </details>
          </fieldset>
        ))}

        <button type="button" className="add-pair" onClick={addPair}>
          + Add another label
        </button>

        <details className="advanced">
          <summary>Advanced settings</summary>

          <label>
            Vision model
            <span className="hint">
              Approximate review time per label.
            </span>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="haiku">
                Claude Haiku — fastest (~5–15 seconds)
              </option>
              <option value="opus">
                Claude Opus — most thorough (~30–60 seconds)
              </option>
            </select>
          </label>

          <label>
            Claude API Key (optional)
            <span className="hint">
              Leave blank to use the server&apos;s configured key. If provided,
              it is used for this review only — sent per request, never stored.
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-... (optional)"
              autoComplete="off"
            />
          </label>
        </details>

        <button type="submit" disabled={loading}>
          {loading
            ? `Reviewing… ${doneCount}/${batch.length} done`
            : pairs.length > 1
              ? `Review ${pairs.length} labels`
              : "Review labels"}
        </button>
      </form>

      {error && <div className="error">{error}</div>}

      {batch.map((item) => (
        <section className="result-item" key={item.name}>
          <h2>
            {item.name}
            {item.status === "pending" && (
              <span className="result-state pending"> reviewing…</span>
            )}
            {item.status === "error" && (
              <span className="result-state failed"> failed</span>
            )}
          </h2>

          {item.status === "error" && (
            <div className="error">{item.error}</div>
          )}

          {item.status === "done" && item.data && (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Requirement</th>
                    <th>Found on</th>
                    <th>Details</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {item.data.checks.map((c) => (
                    <tr key={c.requirement}>
                      <td className={`status ${c.status}`}>{c.status}</td>
                      <td>{c.requirement}</td>
                      <td>{c.foundOn ?? "—"}</td>
                      <td>
                        {c.issues.length > 0 ? (
                          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                            {c.issues.map((issue, i) => (
                              <li key={i}>{issue}</li>
                            ))}
                          </ul>
                        ) : (
                          "OK"
                        )}
                        {c.extractedText && (
                          <div className="hint" style={{ marginTop: "0.3rem" }}>
                            “{c.extractedText}”
                          </div>
                        )}
                      </td>
                      <td>{c.confidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {item.data.applicationConsistency?.length > 0 && (
                <>
                  <h3>Application consistency (TTB F 5100.31)</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Declared field</th>
                        <th>On application</th>
                        <th>On label</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {item.data.applicationConsistency.map((f) => (
                        <tr key={f.field}>
                          <td
                            className={`status ${f.consistent ? "PASS" : "FAIL"}`}
                          >
                            {f.consistent ? "MATCH" : "MISMATCH"}
                          </td>
                          <td>{APP_FIELD_LABELS[f.field] ?? f.field}</td>
                          <td>{f.declaredValue ?? "—"}</td>
                          <td>{f.labelValue ?? "—"}</td>
                          <td>{f.note ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              <div className="summary">
                <strong>Summary:</strong> {item.data.overallSummary}
              </div>
            </>
          )}
        </section>
      ))}

      <p className="disclaimer">
        This tool is a pre-screen only. Only TTB (via COLAs Online) can approve
        a label. Type-size and contrast requirements cannot be verified from
        photographs and require manual review.
      </p>
    </main>
  );
}
