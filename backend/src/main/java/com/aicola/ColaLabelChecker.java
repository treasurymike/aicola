// Solution by Mike Chen <mike2025@rocketship.com> created using Claude Fable 5 AI
// for the U.S. Department of Treasury as part of the candidate interview process.

package com.aicola;

import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.Base64ImageSource;
import com.anthropic.models.messages.ContentBlockParam;
import com.anthropic.models.messages.ImageBlockParam;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.StructuredMessageCreateParams;
import com.anthropic.models.messages.TextBlockParam;
import com.anthropic.models.messages.ThinkingConfigAdaptive;
import com.fasterxml.jackson.annotation.JsonPropertyDescription;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Pre-screens a pair of alcohol beverage label images (front + back) against
 * the 8 mandatory TTB COLA label requirements (27 CFR Parts 4, 5, 7, and 16).
 *
 * This is a pre-screen only — only TTB (via COLAs Online) can approve a label.
 */
@Service
public class ColaLabelChecker {

    // --- 1. Schema: one verdict per COLA requirement (Jackson-annotated records) ---

    public record RequirementCheck(
            @JsonPropertyDescription("Whether this requirement appears on either label") boolean present,
            @JsonPropertyDescription("Which label it was found on: front, back, both, or none") String foundOn,
            @JsonPropertyDescription("Verbatim transcription of the relevant text, preserving capitalization") String extractedText,
            @JsonPropertyDescription("Problems even if present: wrong format, illegible, cut off, etc.") List<String> issues,
            @JsonPropertyDescription("high, medium, or low") String confidence) {}

    public record ColaLabelReview(
            RequirementCheck brandName,
            @JsonPropertyDescription("Class/type designation per the standards of identity") RequirementCheck classAndType,
            RequirementCheck alcoholContent,
            @JsonPropertyDescription("Bottler/producer/importer name and address statement") RequirementCheck nameAndAddress,
            RequirementCheck netContents,
            @JsonPropertyDescription("Imports only") RequirementCheck countryOfOrigin,
            @JsonPropertyDescription("GOVERNMENT WARNING statement per 27 CFR Part 16") RequirementCheck healthWarning,
            @JsonPropertyDescription("Sulfites, FD&C Yellow No. 5, aspartame, etc.") RequirementCheck commodityDisclosures,
            String overallSummary) {}

    private static final String SYSTEM = """
            You are a TTB alcohol beverage label compliance pre-screener.
            You check label images against the COLA mandatory label requirements in
            27 CFR Parts 4 (wine), 5 (distilled spirits), 7 (malt beverages), and 16
            (health warning). For each requirement: report whether it appears, which
            label it appears on, transcribe the relevant text VERBATIM (including
            capitalization), and list any issues. If text is illegible or cut off,
            say so and set confidence accordingly. Do not guess text you cannot read.""";

    // --- 2. Content block helpers ---

    private static ContentBlockParam imageBlock(byte[] bytes, String mediaType) {
        String data = Base64.getEncoder().encodeToString(bytes);
        return ContentBlockParam.ofImage(ImageBlockParam.builder()
                .source(Base64ImageSource.builder()
                        .data(data)
                        .mediaType(Base64ImageSource.MediaType.of(mediaType))
                        .build())
                .build());
    }

    private static ContentBlockParam text(String s) {
        return ContentBlockParam.ofText(TextBlockParam.builder().text(s).build());
    }

    // --- 3. The vision call with typed structured output ---

    /**
     * Runs the review using the caller-supplied Anthropic API key. The key is
     * used for this request only and is never stored.
     */
    public ColaLabelReview reviewLabels(String apiKey,
                                        byte[] frontBytes, String frontMediaType,
                                        byte[] backBytes, String backMediaType,
                                        String commodity, boolean imported) {
        AnthropicClient client = AnthropicOkHttpClient.builder()
                .apiKey(apiKey)
                .build();

        String instructions = "Product type: " + commodity + ". "
                + (imported
                    ? "Imported product — country of origin IS required."
                    : "Domestic product — mark countryOfOrigin present=true with issue note: not applicable.")
                + " Check all 8 COLA requirements across both labels.";

        StructuredMessageCreateParams<ColaLabelReview> params = MessageCreateParams.builder()
                .model("claude-opus-4-8")
                .maxTokens(16000L)
                .thinking(ThinkingConfigAdaptive.builder().build())
                .system(SYSTEM)
                .outputConfig(ColaLabelReview.class)   // schema auto-derived from the record
                .addUserMessageOfBlockParams(List.of(
                        text("FRONT label:"),
                        imageBlock(frontBytes, frontMediaType),
                        text("BACK label:"),
                        imageBlock(backBytes, backMediaType),
                        text(instructions)))
                .build();

        return client.messages().create(params).content().stream()
                .flatMap(block -> block.text().stream())
                .map(typed -> typed.text())            // typed.text() returns ColaLabelReview
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("No structured output in response"));
    }

    // --- 4. Deterministic post-check: health warning exact wording (27 CFR 16.21) ---

    private static final Pattern REQUIRED_WARNING = Pattern.compile(
            "GOVERNMENT WARNING:\\s*\\(1\\)\\s*According to the Surgeon General,\\s*"
            + "women should not drink alcoholic beverages during pregnancy because "
            + "of the risk of birth defects\\.?\\s*\\(2\\)\\s*Consumption of alcoholic "
            + "beverages impairs your ability to drive a car or operate machinery,?\\s*"
            + "and may cause health problems\\.?",
            Pattern.CASE_INSENSITIVE);

    public static List<String> verifyHealthWarning(RequirementCheck check) {
        if (!check.present() || check.extractedText() == null) {
            return check.issues();
        }
        var issues = new ArrayList<>(check.issues());
        String normalized = check.extractedText().replaceAll("\\s+", " ");
        if (!REQUIRED_WARNING.matcher(normalized).find()) {
            issues.add("Warning text does not match the wording prescribed by 27 CFR 16.21 verbatim.");
        }
        if (!check.extractedText().contains("GOVERNMENT WARNING")) {
            issues.add("\"GOVERNMENT WARNING\" must appear in capital letters and bold type.");
        }
        return issues;
    }
}
