/** Controls can be nested inside a viewport without becoming part of its drawing surface. */
export function isStrokeInputControl(target?: EventTarget | null) {
  return Boolean((target as Element | null)?.closest?.(
    'button, input, textarea, select, label, a[href], [role="button"], [contenteditable="true"], [data-stroke-input-ignore]',
  ))
}
