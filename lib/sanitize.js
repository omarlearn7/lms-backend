const sanitizeHtml = require('sanitize-html');

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'span', 'div', 'blockquote', 'code', 'pre', 'hr', 'mark', 'small', 'abbr',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'a', 'img',
];

const ALLOWED_ATTRS = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  '*': ['dir', 'class', 'style'],
};

const SANITIZE_OPTS = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: ALLOWED_ATTRS,
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
};

// Neutralize dangerous CSS (XSS via style) after sanitize-html, which does not
// filter style attribute *content*.
function scrubStyle(html) {
  return html.replace(
    /style\s*=\s*("([^"]*)"|'([^']*)')/gi,
    (match, _q, dq, sq) => {
      let value = dq !== undefined ? dq : sq;
      value = value
        .replace(/expression\s*\(/gi, ' ')
        .replace(/javascript\s*:/gi, ' ')
        .replace(/vbscript\s*:/gi, ' ')
        .replace(/@import[^;]*;?/gi, '')
        .replace(/url\s*\(\s*["']?\s*(javascript|data|vbscript)\s*:/gi, 'url(');
      return `style="${value}"`;
    }
  );
}

function sanitizeHtmlString(html) {
  if (typeof html !== 'string') return html;
  if (!/<[a-z][^>]*>/i.test(html)) return html;
  return scrubStyle(sanitizeHtml(html, SANITIZE_OPTS));
}

const SIMULATION_TYPES = new Set(['simulation', 'artifact']);
const SKIP_KEYS = new Set(['latex', 'css', 'js', 'html', 'config']);

function sanitizeNode(node, key, parentBlock) {
  if (typeof node === 'string') {
    if (key === 'latex') return node;
    // Simulation html/css/js runs inside a sandboxed iframe without
    // allow-same-origin, so it is safe to leave untouched. Everything else
    // (including diagram.html) is rendered into the main document and must be
    // cleaned.
    if (SKIP_KEYS.has(key) && parentBlock && SIMULATION_TYPES.has(parentBlock.type)) return node;
    return sanitizeHtmlString(node);
  }
  if (Array.isArray(node)) return node.map((item) => sanitizeNode(item, key, parentBlock));
  if (node && typeof node === 'object') {
    const blockType = typeof node.type === 'string' ? node.type : null;
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = sanitizeNode(v, k, blockType ? node : parentBlock);
    }
    return out;
  }
  return node;
}

// Sanitize lesson/exercise/quiz content_json. Returns a deep-cleaned copy.
function sanitizeContentJson(contentJson) {
  if (Array.isArray(contentJson)) return contentJson.map((item) => sanitizeNode(item, null, null));
  if (contentJson && typeof contentJson === 'object') return sanitizeNode(contentJson, null, null);
  return contentJson;
}

module.exports = { sanitizeContentJson, sanitizeHtmlString };
