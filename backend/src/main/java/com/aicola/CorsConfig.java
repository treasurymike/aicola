// Solution by Mike Chen <mike2025@rocketship.com> created using Claude Fable 5 AI
// for the U.S. Department of Treasury as part of the candidate interview process.

package com.aicola;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        // Open CORS for development; lock allowedOrigins down to your
        // deployed frontend origin before going to production.
        registry.addMapping("/api/**")
                .allowedOrigins("*")
                .allowedMethods("POST", "OPTIONS")
                .allowedHeaders("*");
    }
}
