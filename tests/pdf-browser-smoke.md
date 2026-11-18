# Browser PDF manual smoke checks

Use synthetic files. Start with the real-library suite described in [the security report](../docs/security-audit.md).

1. Copy `index.html` alone into an empty local folder. Disconnect from the network and open the HTML directly. Verify text import, editing and download, both interface languages and both themes.
2. Load a synthetic multi-page PDF with a scan, digital text and a rotated page. Check page order and visible orientation. While a page remains unviewed, export must be disabled.
3. Draw, remove and restore rectangles. Switch PT/EN during review and verify that geometry and confirmations persist. Any rectangle change must clear the review checkbox. Changing detector choices must require reviewing other pages again.
4. Confirm review and image conversion. Dismiss the last dialog once, then accept it. Open the output in an independent reader. Compare alignment at several zoom levels and confirm the entire sensitive region is black. Verify that text extraction is empty and removing the image from a page leaves no underlying content.
5. Replace the file, cancel a replacement, select the same name again, and try an invalid or encrypted PDF. Failed replacements must preserve the previous review. Close the PDF and confirm that the preview and filename disappear.
6. Repeat across the browser matrix in the [exit criteria](../docs/security-audit.md#criteria-for-leaving-experimental). Note unsupported files and relevant browser/runtime versions.
