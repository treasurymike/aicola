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

interface ReviewResponse {
  checks: RequirementResult[];
  overallSummary: string;
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
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [commodity, setCommodity] = useState("distilled spirits");
  const [imported, setImported] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReviewResponse | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!front || !back) {
      setError("Please provide both label images.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    const [frontScaled, backScaled] = await Promise.all([
      downscaleImage(front),
      downscaleImage(back),
    ]);

    const form = new FormData();
    form.append("front", frontScaled);
    form.append("back", backScaled);
    form.append("commodity", commodity);
    form.append("imported", String(imported));

    try {
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
        throw new Error(
          body?.error ?? `Request failed with status ${res.status}`,
        );
      }

      setResult((await res.json()) as ReviewResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>AI COLA App</h1>
      <p className="subtitle">
        TTB COLA label pre-screener — checks front and back label images
        against the 8 mandatory requirements.
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
        <label>
          Front label image
          <span className="hint">
            Only JPEG, PNG, GIF, and WebP files are allowed.
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(e) => setFront(e.target.files?.[0] ?? null)}
            required
          />
        </label>

        <label>
          Back label image
          <span className="hint">
            Only JPEG, PNG, GIF, and WebP files are allowed.
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(e) => setBack(e.target.files?.[0] ?? null)}
            required
          />
        </label>

        <label>
          Commodity
          <select
            value={commodity}
            onChange={(e) => setCommodity(e.target.value)}
          >
            <option value="wine">Wine</option>
            <option value="distilled spirits">Distilled spirits</option>
            <option value="malt beverage">Malt beverage</option>
          </select>
        </label>

        <div className="checkbox-row">
          <input
            id="imported"
            type="checkbox"
            checked={imported}
            onChange={(e) => setImported(e.target.checked)}
          />
          <label htmlFor="imported">Imported product</label>
        </div>

        <details className="advanced">
          <summary>Advanced settings</summary>
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
          {loading ? "Reviewing… (typically ~10 seconds)" : "Review labels"}
        </button>
      </form>

      {error && <div className="error">{error}</div>}

      {result && (
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
              {result.checks.map((c) => (
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

          <div className="summary">
            <strong>Summary:</strong> {result.overallSummary}
          </div>
        </>
      )}

      <p className="disclaimer">
        This tool is a pre-screen only. Only TTB (via COLAs Online) can approve
        a label. Type-size and contrast requirements cannot be verified from
        photographs and require manual review.
      </p>
    </main>
  );
}
