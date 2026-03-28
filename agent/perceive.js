/**
 * Semantic DOM Snapshot Extractor
 * 
 * Extracts a minimal, token-efficient representation of interactive elements
 * from a web page. Achieves ~90% token reduction vs raw HTML.
 */

/**
 * Extract a semantic snapshot of all interactive/meaningful elements on the page.
 * Each element gets a unique `data-agent-ref` attribute for precise targeting.
 * @param {import('playwright').Page} page - Playwright page instance
 * @returns {Promise<Array>} - Array of element descriptors
 */
export async function getSemanticSnapshot(page) {
  return await page.evaluate(() => {
    let refCounter = 0;

    // Selectors for interactive & content elements
    const INTERACTIVE = [
      'a[href]', 'button', 'input', 'select', 'textarea',
      '[role="button"]', '[role="link"]', '[role="tab"]',
      '[role="menuitem"]', '[role="checkbox"]', '[role="radio"]',
      '[onclick]', '[tabindex]', 'label', 'summary',
    ].join(', ');

    const elements = document.querySelectorAll(INTERACTIVE);
    const snapshot = [];

    for (const el of elements) {
      // Skip hidden/invisible elements
      if (el.offsetParent === null && el.tagName !== 'INPUT' && el.getAttribute('type') !== 'hidden') continue;
      if (el.getAttribute('aria-hidden') === 'true') continue;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      // Assign a unique ref ID
      const ref = `ref-${refCounter++}`;
      el.setAttribute('data-agent-ref', ref);

      const descriptor = {
        ref,
        tag: el.tagName.toLowerCase(),
      };

      // Type (for inputs)
      if (el.type && el.type !== 'submit') descriptor.type = el.type;

      // Text content (truncated for token efficiency)
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      if (text) descriptor.text = text;

      // Value (for inputs with values)  
      if (el.value && el.tagName === 'INPUT') descriptor.value = el.value.slice(0, 50);

      // Placeholder
      if (el.placeholder) descriptor.placeholder = el.placeholder.slice(0, 50);

      // Aria label (often more descriptive than text)
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) descriptor.aria = ariaLabel.slice(0, 60);

      // Href (for links — domain + path only, no query params to save tokens)
      if (el.href) {
        try {
          const url = new URL(el.href);
          descriptor.href = url.pathname.slice(0, 60);
        } catch { /* skip invalid URLs */ }
      }

      // Role 
      const role = el.getAttribute('role');
      if (role) descriptor.role = role;

      // Disabled state
      if (el.disabled) descriptor.disabled = true;

      // Checked state (checkboxes/radios)
      if (el.checked !== undefined) descriptor.checked = el.checked;

      // Select options
      if (el.tagName === 'SELECT') {
        descriptor.options = Array.from(el.options).map(o => ({
          value: o.value,
          text: o.text.slice(0, 40),
          selected: o.selected,
        }));
      }

      snapshot.push(descriptor);
    }

    return snapshot;
  });
}

/**
 * Get a compressed page context (title, URL, any alerts/dialogs)
 * @param {import('playwright').Page} page
 * @returns {Promise<Object>}
 */
export async function getPageContext(page) {
  const title = await page.title();
  const url = page.url();

  // Check for common overlays/modals
  const hasModal = await page.evaluate(() => {
    const modals = document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"], .modal, .popup, [class*="overlay"]'
    );
    for (const m of modals) {
      if (m.offsetParent !== null) return true;
    }
    return false;
  });

  return { title, url, hasModal };
}

/**
 * Format the snapshot into a compact string for LLM consumption.
 * Uses a condensed format to minimize tokens.
 * @param {Object} context - Page context from getPageContext
 * @param {Array} snapshot - Element descriptors from getSemanticSnapshot
 * @returns {string}
 */
export function formatForLLM(context, snapshot) {
  const MAX_ELEMENTS = 120; // Cap to prevent token explosion on heavy pages
  const lines = [
    `Page: ${context.title}`,
    `URL: ${context.url}`,
  ];

  if (context.hasModal) lines.push('⚠ Modal/popup detected on page');

  lines.push('', `Elements (${Math.min(snapshot.length, MAX_ELEMENTS)} of ${snapshot.length}):`);

  const capped = snapshot.slice(0, MAX_ELEMENTS);
  for (const el of capped) {
    const parts = [`[${el.ref}] <${el.tag}>`];
    if (el.type) parts.push(`type=${el.type}`);
    if (el.role) parts.push(`role=${el.role}`);
    if (el.text) parts.push(`"${el.text}"`);
    if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
    if (el.aria) parts.push(`aria="${el.aria}"`);
    if (el.href) parts.push(`href=${el.href}`);
    if (el.value) parts.push(`val="${el.value}"`);
    if (el.disabled) parts.push('DISABLED');
    if (el.checked !== undefined) parts.push(el.checked ? 'CHECKED' : 'UNCHECKED');
    if (el.options) parts.push(`options=[${el.options.map(o => o.text).join('|')}]`);
    lines.push(parts.join(' '));
  }

  return lines.join('\n');
}
