const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const EXTRACTION_PROMPT = `You are extracting a list of library books from raw text pulled out of a PDF. The PDF's format is NOT fixed — it might be a supplier invoice, a packing slip, a plain list, a spreadsheet export, or something else entirely.

Return ONLY a JSON array (no markdown fences, no commentary, no explanation) where each element has this exact shape:
{
  "title": string,
  "author": string | null,
  "referenceNo": string | null,
  "ageBracket": "Kids" | "Adults",
  "grade": string | null
}

Rules:
- One entry per distinct book. If the same title/ISBN appears multiple times because of a quantity column, still output it only once — quantity is handled separately, not part of this list.
- Guess "ageBracket" from context (children's book vs adult/textbook). Default to "Adults" if genuinely unclear.
- If a field isn't present in the text, use null — never invent data.
- Skip lines that are clearly not books (headers, totals, addresses, page numbers, etc).`;

// POST /webhook/library-extract-pdf  (requireAuth, Library Assistant only)
// multipart/form-data with a single "pdf" field. Does NOT touch the database —
// returns a preview list for the assistant to review before anything is saved.
router.post('/', requireAuth, requireAdmin, upload.single('pdf'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No PDF file received.' });
  }

  try {
    const parsed = await pdfParse(req.file.buffer);
    const rawText = (parsed.text || '').trim();

    if (!rawText) {
      return res.status(422).json({ success: false, message: 'Could not read any text from that PDF — it may be a scanned image with no selectable text.' });
    }

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [
          { role: 'user', content: `${EXTRACTION_PROMPT}\n\nHere is the extracted PDF text:\n\n${rawText.slice(0, 40000)}` }
        ],
      }),
    });

    if (!claudeResponse.ok) {
      const errBody = await claudeResponse.text().catch(() => '');
      console.error('[extract-pdf] Claude API error:', claudeResponse.status, errBody);
      return res.status(502).json({ success: false, message: 'Could not process the PDF with the extraction service.' });
    }

    const claudeData = await claudeResponse.json();
    const textBlock = (claudeData.content || []).find(b => b.type === 'text');
    const raw = (textBlock?.text || '').trim().replace(/^```json\s*|\s*```$/g, '');

    let books;
    try {
      books = JSON.parse(raw);
    } catch (e) {
      console.error('[extract-pdf] Failed to parse Claude output as JSON:', raw.slice(0, 500));
      return res.status(502).json({ success: false, message: 'The extraction service returned an unexpected format. Please try again.' });
    }

    if (!Array.isArray(books)) {
      return res.status(502).json({ success: false, message: 'Unexpected extraction result.' });
    }

    res.json({ success: true, books });
  } catch (err) {
    console.error('[extract-pdf] error:', err);
    res.status(500).json({ success: false, message: 'Something went wrong reading that PDF.' });
  }
});

module.exports = router;
