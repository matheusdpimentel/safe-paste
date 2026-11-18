# AI-assisted workflow

Logs, configuration and code shared with AI tools can contain credentials and personal information. SafePaste provides local pattern-based preprocessing followed by human review.

1. Paste text or import a supported local file.
2. Review highlighted segments and enabled categories in **What to detect**. All categories begin enabled.
3. Inspect protected output; patterns can miss names, proprietary secrets and contextual information.
4. Copy only reviewed output to your chosen tool. Its privacy/data-retention policies still apply.
5. Revoke or rotate any credential already exposed. Sanitization cannot undo prior disclosure.

```text
Original → local pattern detection → fictional replacements
                                              ↓
                                         human review
                                              ↓
                                    chosen external tool
```

SafePaste is not an AI model and does not send text to AI providers. The PT/EN switch translates the interface only, preserving Brazilian patterns and original content.

## Contributing with a coding assistant

Describe a failing synthetic case, request a focused source change, add meaningful positive/negative/regression tests, regenerate standalone HTML and verify the interface. Include validation results and unsupported cases in the contribution description.

Follow [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md). Keep code, comments and technical guides in English; maintain the Portuguese README and both interface catalogs. Never paste real credentials or user documents into prompts, tests or commits.

Browser PDFs support manual rectangles and mandatory per-page review; the independent Python CLI has stricter geometry rejection. Neither does OCR or guarantees anonymization. Read [browser PDF](pdf-browser.md) and [PDF CLI](pdf-redaction.md).
