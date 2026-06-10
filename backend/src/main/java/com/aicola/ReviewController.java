// Solution by Mike Chen <mike2025@rocketship.com> created using Claude Fable 5 AI
// for the U.S. Department of Treasury as part of the candidate interview process.

package com.aicola;

import com.aicola.ColaLabelChecker.ColaLabelReview;
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

    public record ReviewResponse(List<RequirementResult> checks, String overallSummary) {}

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
            @RequestParam(defaultValue = "false") boolean imported) throws IOException {

        // Caller-supplied key wins; otherwise fall back to the server's
        // configured key (ANTHROPIC_API_KEY env var). The key is never stored.
        String resolvedKey = (apiKey != null && !apiKey.isBlank())
                ? apiKey.trim() : defaultApiKey;
        if (resolvedKey == null || resolvedKey.isBlank()) {
            throw new IllegalArgumentException(
                    "No API key: supply the X-Anthropic-Api-Key header, or configure "
                    + "ANTHROPIC_API_KEY on the server.");
        }

        ColaLabelReview review = checker.reviewLabels(
                resolvedKey,
                front.getBytes(), imageMediaType(front),
                back.getBytes(), imageMediaType(back),
                commodity, imported);

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

        return new ReviewResponse(results, review.overallSummary());
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
