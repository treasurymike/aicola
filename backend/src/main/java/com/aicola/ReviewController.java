// Solution by Mike Chen <mike2025@rocketship.com> created using Claude Fable 5 AI
// for the U.S. Department of Treasury as part of the candidate interview process.

package com.aicola;

import com.aicola.ColaLabelChecker.ApplicationData;
import com.aicola.ColaLabelChecker.ColaLabelReview;
import com.aicola.ColaLabelChecker.ConsistencyFinding;
import com.aicola.ColaLabelChecker.RequirementCheck;
import com.anthropic.errors.AnthropicServiceException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@RestController
public class ReviewController {

    private static final Set<String> ALLOWED_IMAGE_TYPES =
            Set.of("image/jpeg", "image/png", "image/gif", "image/webp");

    public record RequirementResult(
            String requirement, boolean present, String foundOn,
            String extractedText, List<String> issues, String confidence, String status) {}

    public record ReviewResponse(List<RequirementResult> checks,
                                 List<ConsistencyFinding> applicationConsistency,
                                 String overallSummary) {}

    private final ColaLabelChecker checker;
    private final String defaultApiKey;

    public ReviewController(ColaLabelChecker checker,
                            @Value("${ANTHROPIC_API_KEY:}") String defaultApiKey) {
        this.checker = checker;
        this.defaultApiKey = defaultApiKey;
    }

    @PostMapping(value = "/api/review", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ReviewResponse review(
            @RequestHeader(value = "X-Anthropic-Api-Key", required = false) String apiKey,
            @RequestPart("front") MultipartFile front,
            @RequestPart("back") MultipartFile back,
            @RequestParam(defaultValue = "distilled spirits") String commodity,
            @RequestParam(defaultValue = "false") boolean imported,
            @RequestParam(defaultValue = "haiku") String model,
            @RequestParam(required = false) String applicantNameAddress,
            @RequestParam(required = false) String brandName,
            @RequestParam(required = false) String classType,
            @RequestParam(required = false) String netContents,
            @RequestParam(required = false) String alcoholContent) throws IOException {

        // Caller-supplied key wins; otherwise fall back to the server's
        // configured key (ANTHROPIC_API_KEY env var). The key is never stored.
        String resolvedKey = (apiKey != null && !apiKey.isBlank())
                ? apiKey.trim() : defaultApiKey;
        if (resolvedKey == null || resolvedKey.isBlank()) {
            throw new IllegalArgumentException(
                    "No API key: supply the X-Anthropic-Api-Key header, or configure "
                    + "ANTHROPIC_API_KEY on the server.");
        }

        // Whitelisted model choice — never pass client-supplied model strings through
        ColaLabelChecker.VisionModel visionModel = "opus".equalsIgnoreCase(model)
                ? ColaLabelChecker.VisionModel.OPUS
                : ColaLabelChecker.VisionModel.HAIKU;

        ApplicationData appData = new ApplicationData(
                applicantNameAddress, brandName, classType, netContents, alcoholContent);

        ColaLabelReview review = checker.reviewLabels(
                resolvedKey, visionModel,
                front.getBytes(), imageMediaType(front),
                back.getBytes(), imageMediaType(back),
                commodity, imported, appData);

        var results = new ArrayList<RequirementResult>();
        results.add(toResult("Brand name", review.brandName(), review.brandName().issues()));
        results.add(toResult("Class and type designation", review.classAndType(), review.classAndType().issues()));
        results.add(toResult("Alcohol content", review.alcoholContent(), review.alcoholContent().issues()));
        results.add(toResult("Name and address", review.nameAndAddress(), review.nameAndAddress().issues()));
        results.add(toResult("Net contents", review.netContents(), review.netContents().issues()));
        results.add(toResult("Country of origin", review.countryOfOrigin(), review.countryOfOrigin().issues()));
        results.add(toResult("Government health warning", review.healthWarning(),
                ColaLabelChecker.verifyHealthWarning(review.healthWarning())));
        results.add(toResult("Commodity-specific disclosures", review.commodityDisclosures(),
                review.commodityDisclosures().issues()));

        List<ConsistencyFinding> consistency =
                applyDeterministicConsistency(review.applicationConsistency(), review);

        return new ReviewResponse(results, consistency, review.overallSummary());
    }

    /**
     * Belt-and-suspenders for exact-match fields: if the model called the label
     * consistent but a normalized text comparison disagrees, flip the finding.
     * Same philosophy as the health-warning regex — prescribed-text matching
     * never rests on model judgment alone.
     */
    private static List<ConsistencyFinding> applyDeterministicConsistency(
            List<ConsistencyFinding> findings, ColaLabelReview review) {
        if (findings == null) {
            return List.of();
        }
        return findings.stream().map(f -> {
            String labelText = switch (f.field() == null ? "" : f.field()) {
                case "brandName" -> review.brandName().extractedText();
                case "netContents" -> review.netContents().extractedText();
                default -> null;
            };
            if (f.consistent() && f.declaredValue() != null && labelText != null) {
                String declared = normalize(f.declaredValue());
                String label = normalize(labelText);
                if (!declared.isEmpty() && !label.equals(declared) && !label.contains(declared)) {
                    String note = (f.note() == null || f.note().isBlank()) ? "" : f.note() + " ";
                    return new ConsistencyFinding(f.field(), f.declaredValue(), f.labelValue(),
                            false, note + "Deterministic text comparison: the label text does "
                            + "not match the declared value.");
                }
            }
            return f;
        }).toList();
    }

    private static String normalize(String s) {
        return s.toLowerCase(Locale.ROOT).replaceAll("[\\s.,]", "");
    }

    private static RequirementResult toResult(String name, RequirementCheck check, List<String> issues) {
        List<String> safeIssues = issues == null ? List.of() : issues;
        String status = !check.present() ? "FAIL" : safeIssues.isEmpty() ? "PASS" : "WARN";
        return new RequirementResult(name, check.present(), check.foundOn(),
                check.extractedText(), safeIssues, check.confidence(), status);
    }

    private static String imageMediaType(MultipartFile file) {
        String contentType = file.getContentType();
        if (contentType != null && ALLOWED_IMAGE_TYPES.contains(contentType.toLowerCase(Locale.ROOT))) {
            return contentType.toLowerCase(Locale.ROOT);
        }
        String name = file.getOriginalFilename();
        if (name != null && name.toLowerCase(Locale.ROOT).endsWith(".png")) {
            return "image/png";
        }
        return "image/jpeg";
    }

    @ExceptionHandler(AnthropicServiceException.class)
    public ResponseEntity<Map<String, String>> handleAnthropicError(AnthropicServiceException e) {
        // Pass the Anthropic status through (401 = bad API key, 429 = rate limited, ...)
        return ResponseEntity.status(e.statusCode())
                .body(Map.of("error", "Claude API error: " + e.getMessage()));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> handleBadRequest(IllegalArgumentException e) {
        return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
    }
}
