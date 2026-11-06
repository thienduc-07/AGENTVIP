/**
 * Universal Text Sanitizer & Formatter
 * Eliminates raw LaTeX delimiters (\[, \], \(, \), $$), converts LaTeX math
 * into clean Unicode math symbols (×, ÷, ·, √, ², ∀, ∈, ℝ, etc.),
 * and removes stray markdown/backslash artifacts so chat responses and 3D speech
 * bubbles are 100% clean and readable.
 */

export function sanitizeAndFormatAIResponse(raw: string): string {
  if (!raw) return "";

  let text = raw;

  // 1. Remove LaTeX block and inline delimiters \[ \], \( \), $$ $$, $ $
  text = text
    .replace(/\\\[([\s\S]*?)\\\]/g, "$1")
    .replace(/\\\(([\s\S]*?)\\\)/g, "$1")
    .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
    .replace(/\$([^\$\n]+)\$/g, "$1");

  // 2. Convert common LaTeX fractions, roots, and mathematical commands
  text = text
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1 / $2)")
    .replace(/\\sqrt\[(\d+)\]\{([^{}]+)\}/g, "$1√($2)")
    .replace(/\\sqrt\{([^{}]+)\}/g, "√($1)")
    .replace(/\\underbrace\{([^{}]+)\}_\{([^{}]+)\}/g, "$1 ($2)")
    .replace(/\\overbrace\{([^{}]+)\}\^\{([^{}]+)\}/g, "$1 ($2)")
    .replace(/\\text\{([^{}]+)\}/g, "$1")
    .replace(/\\mathbf\{([^{}]+)\}/g, "$1")
    .replace(/\\mathrm\{([^{}]+)\}/g, "$1")
    .replace(/\\math[a-zA-Z]+\{([^{}]+)\}/g, "$1");

  // 3. Convert LaTeX math symbols to beautiful Unicode characters
  const latexToUnicode: Record<string, string> = {
    "\\times": "×",
    "\\div": "÷",
    "\\cdot": "·",
    "\\pm": "±",
    "\\mp": "∓",
    "\\approx": "≈",
    "\\neq": "≠",
    "\\ne": "≠",
    "\\leq": "≤",
    "\\le": "≤",
    "\\geq": "≥",
    "\\ge": "≥",
    "\\infty": "∞",
    "\\forall": "∀",
    "\\exists": "∃",
    "\\in": "∈",
    "\\notin": "∉",
    "\\subset": "⊂",
    "\\subseteq": "⊆",
    "\\cup": "∪",
    "\\cap": "∩",
    "\\sum": "∑",
    "\\prod": "∏",
    "\\int": "∫",
    "\\alpha": "α",
    "\\beta": "β",
    "\\gamma": "γ",
    "\\delta": "δ",
    "\\pi": "π",
    "\\theta": "θ",
    "\\lambda": "λ",
    "\\mu": "μ",
    "\\sigma": "σ",
    "\\tau": "τ",
    "\\phi": "φ",
    "\\omega": "ω",
    "\\mathbb{R}": "ℝ",
    "\\mathbb{N}": "ℕ",
    "\\mathbb{Z}": "ℤ",
    "\\mathbb{Q}": "ℚ",
    "\\mathbb{C}": "ℂ",
    "\\to": "→",
    "\\rightarrow": "→",
    "\\leftarrow": "←",
    "\\Rightarrow": "⇒",
    "\\Leftarrow": "⇐",
    "\\quad": "  ",
    "\\qquad": "    ",
    "\\,": " ",
    "\\;": " ",
    "\\!": "",
  };

  for (const [cmd, unicode] of Object.entries(latexToUnicode)) {
    text = text.split(cmd).join(unicode);
  }

  // 4. Superscripts & Subscripts handling
  text = text.replace(/\^\{([^{}]+)\}/g, "^$1");
  text = text.replace(/_\{([^{}]+)\}/g, "_$1");

  // 5. Remove stray backslashes before characters like \$, \%, \[, \], etc.
  text = text.replace(/\\([a-zA-Z0-9_%+-\[\]\(\)])/g, "$1");

  return text.trim();
}

/**
 * Strips all markdown markers (*, **, #, `, backticks) for display inside
 * 3D speech bubbles or compact HUD pills so dialogue is 100% natural prose.
 */
export function stripMarkdownForSpeechBubble(text: string): string {
  if (!text) return "";
  const cleaned = sanitizeAndFormatAIResponse(text);
  return cleaned
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Formats structured text into clean lines with bold/list highlights
 * without exposing raw markdown asterisks to the end user.
 */
export function renderCleanFormattedSegments(text: string): Array<{
  type: "heading" | "bullet" | "bold_lead" | "paragraph" | "code_block";
  content: string;
  lead?: string;
}> {
  const sanitized = sanitizeAndFormatAIResponse(text);
  const lines = sanitized.split("\n");
  const segments: Array<{
    type: "heading" | "bullet" | "bold_lead" | "paragraph" | "code_block";
    content: string;
    lead?: string;
  }> = [];

  let inCode = false;
  let codeBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      if (inCode) {
        segments.push({
          type: "code_block",
          content: codeBuffer.join("\n"),
        });
        codeBuffer = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;

    // Heading
    if (trimmed.startsWith("###") || trimmed.startsWith("##") || trimmed.startsWith("#")) {
      const hText = trimmed.replace(/^#+\s*/, "");
      segments.push({ type: "heading", content: hText });
      continue;
    }

    // Bullet point with bold prefix: "- **Title**: Description"
    const bulletBoldMatch = trimmed.match(/^[-*•]\s*\*\*([^*]+)\*\*:\s*(.*)$/);
    if (bulletBoldMatch) {
      segments.push({
        type: "bullet",
        lead: bulletBoldMatch[1],
        content: bulletBoldMatch[2].replace(/\*\*([^*]+)\*\*/g, "$1"),
      });
      continue;
    }

    // Standard bullet point
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("• ")) {
      segments.push({
        type: "bullet",
        content: trimmed.replace(/^[-*•]\s*/, "").replace(/\*\*([^*]+)\*\*/g, "$1"),
      });
      continue;
    }

    // Numbered item with bold prefix: "1. **Title**: Description"
    const numBoldMatch = trimmed.match(/^(\d+\.)\s*\*\*([^*]+)\*\*:\s*(.*)$/);
    if (numBoldMatch) {
      segments.push({
        type: "bullet",
        lead: `${numBoldMatch[1]} ${numBoldMatch[2]}`,
        content: numBoldMatch[3].replace(/\*\*([^*]+)\*\*/g, "$1"),
      });
      continue;
    }

    // Regular paragraph: strip remaining raw ** and * safely
    const cleanPara = trimmed
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1");

    segments.push({ type: "paragraph", content: cleanPara });
  }

  if (codeBuffer.length > 0) {
    segments.push({
      type: "code_block",
      content: codeBuffer.join("\n"),
    });
  }

  return segments;
}

