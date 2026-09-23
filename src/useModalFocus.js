import { useLayoutEffect, useRef } from "react";

const modalStack = [];
const focusableSelector = 'button, a[href], input:not([type="hidden"]), select, textarea, [tabindex], [contenteditable="true"]';

function tabbableElements(dialog) {
  const view = dialog.ownerDocument.defaultView;
  return [...dialog.querySelectorAll(focusableSelector)].filter((element) => {
    if (element.disabled || element.tabIndex < 0 || element.getAttribute("aria-disabled") === "true" || element.closest("[inert]")) return false;
    if (!element.getClientRects().length) return false;
    const style = view?.getComputedStyle(element);
    return style?.visibility !== "hidden" && style?.display !== "none";
  });
}

function initialControl(dialog) {
  const elements = tabbableElements(dialog);
  const marked = dialog.querySelector("[data-modal-initial-focus]");
  return (elements.includes(marked) ? marked : null) ||
    elements.find((element) => element.getAttribute("role") === "tab" && element.getAttribute("aria-selected") === "true") ||
    elements.find((element) => ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)) ||
    elements.find((element) => element.getAttribute("data-destructive") !== "true") ||
    dialog;
}

function focusElement(element) {
  element?.focus({ preventScroll: true });
}

/** Move focus into a mounted dialog, contain keyboard navigation, then restore its opener. */
export function useModalFocus(dialogRef, onClose) {
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const document = dialog.ownerDocument;
    const opener = document.activeElement;
    const originalTabIndex = dialog.getAttribute("tabindex");
    if (originalTabIndex === null) dialog.setAttribute("tabindex", "-1");
    modalStack.push(dialog);
    const isTopModal = () => modalStack[modalStack.length - 1] === dialog;

    const keyDown = (event) => {
      if (!isTopModal() || event.isComposing) return;
      if (event.key === "Escape" && closeRef.current) {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = tabbableElements(dialog);
      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;
      if (!first) {
        event.preventDefault();
        focusElement(dialog);
      } else if (!dialog.contains(active) || active === dialog || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        event.stopPropagation();
        focusElement(event.shiftKey ? last : first);
      }
    };
    const focusIn = (event) => {
      if (isTopModal() && !dialog.contains(event.target)) focusElement(initialControl(dialog));
    };

    document.addEventListener("keydown", keyDown, true);
    document.addEventListener("focusin", focusIn, true);
    focusElement(initialControl(dialog));
    return () => {
      const wasTopModal = isTopModal();
      document.removeEventListener("keydown", keyDown, true);
      document.removeEventListener("focusin", focusIn, true);
      const index = modalStack.lastIndexOf(dialog);
      if (index !== -1) modalStack.splice(index, 1);
      if (originalTabIndex === null) dialog.removeAttribute("tabindex");
      if (wasTopModal && opener?.isConnected) focusElement(opener);
    };
  }, [dialogRef]);
}

export default useModalFocus;
