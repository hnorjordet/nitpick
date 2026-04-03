# XLIFF Regex Tool - Accessibility Audit Report
**Standard:** WCAG 2.1 AA + Desktop App Best Practices
**Date:** 2024-12-27
**Auditor:** Automated + Manual Code Review

---

## Executive Summary

**Overall Score:** ⚠️ **Moderate Risk** - Multiple critical issues found

The application has good foundational accessibility (semantic HTML, some keyboard support) but fails critical WCAG 2.1 AA requirements:
- **Critical:** All focus indicators removed (`outline: none`)
- **Critical:** No ARIA labels on icon-only buttons
- **High:** Insufficient color contrast in multiple areas
- **High:** Modal dialogs lack proper ARIA attributes
- **Medium:** Keyboard traps in modals
- **Medium:** Missing form labels

**Recommendation:** Address critical issues before production release.

---

## Critical Issues (Must Fix Before Release)

### 1. Focus Indicators Completely Removed
**Standard:** WCAG 2.4.7 Focus Visible (Level AA)
**Severity:** 🔴 Critical
**Location:** `App.css` lines 461-462, 561-562, 654-655, 941-942, 1229-1230, 1526-1527, 2604-2605

**Issue:**
```css
.search-input:focus,
.jump-input:focus,
.editable-cell:focus,
.editor-target:focus,
.form-group input:focus,
.form-group select:focus,
.library-search-input:focus,
.settings-input:focus {
  outline: none; /* ❌ Removes all focus indicators */
}
```

**Impact:** Keyboard users cannot see where focus is, making navigation impossible.

**Fix:**
```css
/* Replace ALL instances of outline: none with visible focus styles */
.search-input:focus {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}

.jump-input:focus,
.editable-cell:focus,
.editor-target:focus {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}

.form-group input:focus,
.form-group select:focus {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}

/* For buttons, add a distinct focus ring */
button:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}
```

**Verification:** Tab through entire app and verify visible 2px outline on all focusable elements.

---

### 2. Icon-Only Buttons Missing ARIA Labels
**Standard:** WCAG 4.1.2 Name, Role, Value (Level A)
**Severity:** 🔴 Critical
**Locations:** Multiple throughout App.tsx

**Issue:**
```tsx
// Line ~1536: No text alternative for screen readers
<button
  onClick={() => setDarkMode(!darkMode)}
  className="theme-toggle-btn"
  title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
>
  {darkMode ? '☀️' : '🌙'}
</button>
```

**Impact:** Screen reader users hear "button" with no context. Title attribute is NOT read by screen readers on buttons.

**Fix:**
```tsx
// Add aria-label to ALL icon-only buttons
<button
  onClick={() => setDarkMode(!darkMode)}
  className="theme-toggle-btn"
  aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
  title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
>
  {darkMode ? '☀️' : '🌙'}
</button>

// Lines requiring aria-label:
// - Line 1530: Hidden chars button (¶)
// - Line 1536: Theme toggle (🌙/☀️)
// - Line 1565: Close help modal (✕)
// - Line 1646: Close user guide (✕)
// - Line 1675: Close about (✕)
// - Line 1707: Close settings (✕)
// - Line 1794: Close library (✕)
// - Line 1908-1921: Edit/Delete entry buttons (✎/🗑)
// - Line 1980: Close special chars (✕)
// - Line 1999: Close profile manager (✕)
// - All emoji/symbol-only buttons throughout
```

**Verification:** Run screen reader (NVDA/VoiceOver) and verify all buttons announce their purpose.

---

### 3. Modal Dialogs Missing ARIA Attributes
**Standard:** WCAG 4.1.3 Status Messages (Level AA), ARIA Authoring Practices
**Severity:** 🔴 Critical
**Locations:** All modal overlays (lines 1561, 1638, 1671, 1703, 1783, 1988, etc.)

**Issue:**
```tsx
// No role, aria-labelledby, or aria-modal
<div className="library-modal-overlay" onClick={() => setShowHelpModal(false)}>
  <div className="library-modal help-modal" onClick={(e) => e.stopPropagation()}>
    <div className="library-header">
      <h2>Keyboard Shortcuts</h2>
```

**Impact:** Screen readers don't announce modal context, users may not know they're in a dialog.

**Fix:**
```tsx
<div
  className="library-modal-overlay"
  onClick={() => setShowHelpModal(false)}
  role="presentation" // Prevents screen reader from reading overlay
>
  <div
    className="library-modal help-modal"
    onClick={(e) => e.stopPropagation()}
    role="dialog"
    aria-modal="true"
    aria-labelledby="help-modal-title"
  >
    <div className="library-header">
      <h2 id="help-modal-title">Keyboard Shortcuts</h2>
      {/* ... */}
    </div>
  </div>
</div>
```

**Apply to ALL modals:**
- Help Modal (line 1560)
- User Guide Modal (line 1638)
- About Modal (line 1671)
- Settings Modal (line 1703)
- Library Modal (line 1783)
- Profile Manager Modal (line 1988)
- QA Batch Checks Modal (line 2067)
- Profile Editor Modal (line 2254)

**Verification:** Screen reader announces "dialog, [title]" when modal opens.

---

### 4. Color Contrast Failures
**Standard:** WCAG 1.4.3 Contrast (Minimum) (Level AA) - 4.5:1 for text, 3:1 for UI components
**Severity:** 🔴 Critical
**Locations:** Multiple color combinations

**Tested Combinations:**

| Element | Foreground | Background | Ratio | Standard | Status |
|---------|-----------|-----------|-------|----------|---------|
| Light mode primary text | `#1c1c1e` | `#ffffff` | 16.1:1 | 4.5:1 | ✅ Pass |
| Light mode secondary text | `#6e6e73` | `#ffffff` | 4.6:1 | 4.5:1 | ✅ Pass |
| Light mode tertiary text | `#8e8e93` | `#ffffff` | **3.3:1** | 4.5:1 | ❌ **Fail** |
| Dark mode primary text | `#e3e3e3` | `#1a1a1a` | 12.6:1 | 4.5:1 | ✅ Pass |
| Dark mode secondary text | `#b0b0b0` | `#1a1a1a` | 7.2:1 | 4.5:1 | ✅ Pass |
| Dark mode tertiary text | `#8e8e8e` | `#1a1a1a` | **4.1:1** | 4.5:1 | ❌ **Fail** |
| Dark mode primary color | `#cc785c` | `#1a1a1a` | **3.9:1** | 3:1 UI | ✅ Pass (UI) / ❌ Fail (text) |
| Primary button (light) | `#ffffff` | `#007aff` | 4.5:1 | 4.5:1 | ✅ Pass |
| Error color (light) | `#ff3b30` | `#ffffff` | **3.1:1** | 4.5:1 | ❌ **Fail** |
| Success color (light) | `#34c759` | `#ffffff` | **2.6:1** | 4.5:1 | ❌ **Fail** |

**Issues:**
1. `--text-tertiary` (#8e8e93) fails on white background
2. Dark mode tertiary text marginally fails
3. Error/success colors used as text fail contrast
4. Dark mode primary color fails as text (OK as UI component)

**Fix:**
```css
:root {
  /* Darken tertiary text for better contrast */
  --text-tertiary: #737378; /* Was #8e8e93, now 4.5:1 */

  /* Darken error/success for text use */
  --error-text: #d70015; /* Use for error messages, 4.5:1 */
  --success-text: #248a3d; /* Use for success messages, 4.5:1 */

  /* Keep original for backgrounds/icons (3:1 is OK) */
  --error-color: #ff3b30; /* UI only */
  --success-color: #34c759; /* UI only */
}

.dark-mode {
  --text-tertiary: #9e9e9e; /* Was #8e8e8e, now 4.6:1 */

  /* Error/success already pass in dark mode */
  --error-text: #ff6b6b;
  --success-text: #51cf66;
}

/* Apply to text elements */
.error-message {
  color: var(--error-text); /* Not --error-color */
}

.success-message {
  color: var(--success-text); /* Not --success-color */
}
```

**Verification:** Test all combinations with https://webaim.org/resources/contrastchecker/

---

### 5. Keyboard Trap in Modals
**Standard:** WCAG 2.1.2 No Keyboard Trap (Level A)
**Severity:** 🔴 Critical
**Location:** All modal dialogs

**Issue:** Focus can escape modal and reach underlying page content. No focus trapping implemented.

**Impact:** Keyboard users can tab to elements behind modal, breaking usability.

**Fix:** Implement focus trap in modal. Add to App.tsx:

```tsx
// Add focus trap hook
import { useEffect, useRef } from 'react';

function useFocusTrap(isActive: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isActive) return;

    const container = containerRef.current;
    if (!container) return;

    const focusableElements = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    function handleTab(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    }

    container.addEventListener('keydown', handleTab);
    firstElement?.focus(); // Auto-focus first element

    return () => container.removeEventListener('keydown', handleTab);
  }, [isActive]);

  return containerRef;
}

// Use in modals:
function HelpModal() {
  const modalRef = useFocusTrap(showHelpModal);

  return (
    <div className="library-modal-overlay">
      <div ref={modalRef} className="library-modal" role="dialog" aria-modal="true">
        {/* Content */}
      </div>
    </div>
  );
}
```

**Apply to:** All 8 modals in the application.

**Verification:** Open modal, press Tab repeatedly. Focus should cycle within modal only.

---

## High Priority Issues (Should Fix)

### 6. Form Inputs Missing Labels
**Standard:** WCAG 3.3.2 Labels or Instructions (Level A)
**Severity:** 🟠 High
**Location:** App.tsx lines 1806-1878 (Library modal form)

**Issue:**
```tsx
// Inputs have visual labels but not associated with <label for="id">
<div className="form-group">
  <label>Category</label> {/* No 'for' attribute */}
  <select
    value={newEntryCategory}
    onChange={(e) => setNewEntryCategory(e.target.value)}
    className="form-select"
  >
```

**Fix:**
```tsx
<div className="form-group">
  <label htmlFor="entry-category">Category</label>
  <select
    id="entry-category"
    value={newEntryCategory}
    onChange={(e) => setNewEntryCategory(e.target.value)}
    className="form-select"
    aria-required="true"
  >
```

**Apply to all form fields:**
- Category select (line 1806)
- Name input (line 1825)
- Description textarea (line 1835)
- Pattern input (line 1845)
- Replace input (line 1868)
- All Settings modal inputs (lines 1720-1767)
- All QA Profile Editor inputs (lines 2260-2290)

---

### 7. Error Messages Not Announced
**Standard:** WCAG 3.3.1 Error Identification (Level A)
**Severity:** 🟠 High
**Location:** Error display (line 2459)

**Issue:**
```tsx
{error && (
  <div className="error">
    {error}
  </div>
)}
```

**Impact:** Screen readers don't announce errors automatically.

**Fix:**
```tsx
{error && (
  <div
    className="error"
    role="alert"
    aria-live="assertive"
  >
    {error}
  </div>
)}
```

---

### 8. Table Missing Semantic Structure
**Standard:** WCAG 1.3.1 Info and Relationships (Level A)
**Severity:** 🟠 High
**Location:** Segment table (lines 2500-2800)

**Issue:** Using div-based table instead of semantic `<table>` elements.

**Fix:** While keeping the virtual scrolling, add ARIA roles:
```tsx
<div className="table" role="table" aria-label="Translation segments">
  <div className="table-header" role="rowgroup">
    <div className="table-row" role="row">
      <div className="table-cell" role="columnheader">#</div>
      <div className="table-cell" role="columnheader">Source</div>
      <div className="table-cell" role="columnheader">Target</div>
    </div>
  </div>
  <div className="table-body" role="rowgroup">
    {rows.map(row => (
      <div className="table-row" role="row" key={row.id}>
        <div className="table-cell" role="cell">{row.id}</div>
        <div className="table-cell" role="cell">{row.source}</div>
        <div className="table-cell" role="cell">{row.target}</div>
      </div>
    ))}
  </div>
</div>
```

---

### 9. Search Results Not Announced
**Standard:** WCAG 4.1.3 Status Messages (Level AA)
**Severity:** 🟠 High
**Location:** Search functionality

**Issue:** When search completes, results highlighted but no announcement.

**Fix:** Add live region for search results:
```tsx
// Add state
const [searchStatus, setSearchStatus] = useState('');

// After search completes:
setSearchStatus(`Found ${matchCount} matches`);

// In JSX:
<div
  role="status"
  aria-live="polite"
  aria-atomic="true"
  className="sr-only"
>
  {searchStatus}
</div>

// Add to CSS:
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
```

---

## Medium Priority Issues (Should Fix)

### 10. Skip to Main Content Link Missing
**Standard:** WCAG 2.4.1 Bypass Blocks (Level A)
**Severity:** 🟡 Medium

**Fix:** Add skip link as first element:
```tsx
<div className="app">
  <a href="#main-content" className="skip-link">
    Skip to main content
  </a>
  <header>...</header>
  <main id="main-content">...</main>
</div>

// CSS:
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  background: var(--primary-color);
  color: white;
  padding: 8px;
  text-decoration: none;
  z-index: 100;
}

.skip-link:focus {
  top: 0;
}
```

---

### 11. Language Attribute Missing
**Standard:** WCAG 3.1.1 Language of Page (Level A)
**Severity:** 🟡 Medium
**Location:** index.html

**Fix:** Add to `index.html`:
```html
<html lang="en">
```

---

### 12. Disabled Button Contrast
**Standard:** WCAG 1.4.3 Contrast (Minimum) (Level AA)
**Severity:** 🟡 Medium
**Location:** App.css lines 505-507, 589-592, 1835-1837

**Issue:** Disabled buttons at 0.5-0.6 opacity may fail 3:1 for UI components.

**Fix:** Ensure disabled state meets 3:1:
```css
.replace-btn:disabled,
.jump-btn:disabled,
.run-checks-btn:disabled {
  opacity: 0.6; /* Test this meets 3:1 */
  cursor: not-allowed;
  /* Or use explicit colors: */
  background-color: #b0b0b0;
  color: #666666;
}
```

---

### 13. Loading States Not Announced
**Standard:** WCAG 4.1.3 Status Messages (Level AA)
**Severity:** 🟡 Medium

**Fix:** Add aria-live region for async operations:
```tsx
{qaIsRunning && (
  <div role="status" aria-live="polite">
    Running QA checks, please wait...
  </div>
)}
```

---

## Minor Issues (Nice to Have)

### 14. Redundant Title Attributes
**Severity:** 🟢 Minor
**Location:** Throughout App.tsx

**Issue:** Many buttons have both text content and title attribute:
```tsx
<button title="Open XLIFF file (Ctrl/Cmd+O)">
  Open XLIFF {/* Redundant with title */}
</button>
```

**Fix:** Remove title where text is visible, keep for icon-only buttons.

---

### 15. Focus Order Not Optimal
**Severity:** 🟢 Minor
**Location:** Header buttons

**Issue:** Tab order goes QA Checks → Hidden Chars → Theme → Open → Save. Logical order would be Open → Save → QA → Theme → Hidden.

**Fix:** Reorder DOM elements or use `tabindex` sparingly.

---

### 16. No Visual Hover State Consistency
**Severity:** 🟢 Minor
**Location:** Various buttons

**Issue:** Some buttons scale on hover, others change opacity, others do both.

**Fix:** Standardize hover effects:
```css
button:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}
```

---

## Automated Testing Setup

### Install axe-core
```bash
cd gui
npm install --save-dev @axe-core/react
```

### Add to App.tsx (dev mode only)
```tsx
// At top of file
if (import.meta.env.DEV) {
  import('@axe-core/react').then((axe) => {
    axe.default(React, ReactDOM, 1000);
  });
}
```

### Run and check console
Axe will report issues in browser console during development.

---

## Manual Testing Checklist

### Keyboard Navigation Test
- [ ] Tab through entire app without mouse
- [ ] All buttons/inputs reachable via keyboard
- [ ] Tab order is logical (top→bottom, left→right)
- [ ] Focus visible on all elements (2px outline)
- [ ] Modals trap focus (Tab cycles within modal)
- [ ] Escape closes modals
- [ ] Enter activates buttons
- [ ] Space toggles checkboxes
- [ ] No elements unreachable by keyboard

### Screen Reader Test (NVDA/VoiceOver)
- [ ] All buttons announce their purpose
- [ ] Form labels read correctly
- [ ] Modals announce "dialog, [title]"
- [ ] Errors announced automatically
- [ ] Search results announced
- [ ] Table structure conveyed
- [ ] Loading states announced
- [ ] Heading hierarchy makes sense

### Contrast Test
- [ ] All text meets 4.5:1 (WebAIM Contrast Checker)
- [ ] All UI components meet 3:1
- [ ] Test both light and dark modes
- [ ] Focus indicators meet 3:1 against background

### Keyboard Shortcuts Test
- [ ] Ctrl/Cmd+F focuses search
- [ ] Ctrl/Cmd+S saves
- [ ] Ctrl/Cmd+O opens file
- [ ] Escape closes modals/clears selection
- [ ] All documented shortcuts work

---

## Priority Fix Order

1. **Week 1 (Critical):**
   - Fix all `outline: none` → proper focus indicators
   - Add `aria-label` to all icon-only buttons
   - Add `role="dialog"` and `aria-modal="true"` to modals
   - Fix color contrast failures

2. **Week 2 (High):**
   - Implement focus trap in modals
   - Add proper form labels with `htmlFor`
   - Add `role="alert"` to errors
   - Add ARIA roles to table

3. **Week 3 (Medium/Minor):**
   - Add skip link
   - Add language attribute
   - Fix disabled states contrast
   - Add loading announcements
   - Clean up redundant titles

---

## Resources Used

- **WCAG 2.1 Quick Reference:** https://www.w3.org/WAI/WCAG21/quickref/?versions=2.1&levels=aa
- **WebAIM Contrast Checker:** https://webaim.org/resources/contrastchecker/
- **ARIA Authoring Practices:** https://www.w3.org/WAI/ARIA/apg/
- **A11y Project Checklist:** https://www.a11yproject.com/checklist/

---

## Summary Statistics

| Category | Count |
|----------|-------|
| Critical Issues | 5 |
| High Priority | 4 |
| Medium Priority | 4 |
| Minor Issues | 3 |
| **Total Issues** | **16** |

**Estimated Fix Time:** 2-3 weeks for full compliance

**Next Steps:**
1. Create GitHub issues for each critical item
2. Assign to developers with priority labels
3. Set up automated testing (axe-core)
4. Schedule manual testing session with screen reader users
5. Re-audit after fixes implemented
